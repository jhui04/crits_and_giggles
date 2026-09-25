"""Small vision-language-model helper for classifying image crops (plan Phase 4a).

Talks to the same OpenAI-compatible endpoint as the app. It is only ever asked to
classify a crop into a fixed list of words, or to answer yes/no. Never for coordinates.
Answers are cached on disk, so re-running a build is free and deterministic.
"""
import base64
import hashlib
import json
import os
import urllib.request

import cv2

from common import CACHE

CACHE_DIR = os.path.join(CACHE, 'vlm')


def base_url():
    return (os.environ.get('LLM_BASE_URL') or os.environ.get('OLLAMA_BASE_URL')
            or 'http://localhost:11434/v1').rstrip('/')


def model_name():
    return os.environ.get('MAPS_VLM_MODEL') or 'qwen3.5:9b'


def encode_png(img_bgr):
    ok, buf = cv2.imencode('.png', img_bgr)
    if not ok:
        raise ValueError('Could not encode the image crop.')
    return buf.tobytes()


def _cache_path(png, prompt, model):
    h = hashlib.sha1(png + prompt.encode('utf-8') + model.encode('utf-8')).hexdigest()
    return os.path.join(CACHE_DIR, h + '.json')


class VLM:
    """enabled=False makes every question return None (the --no-vlm mode)."""

    def __init__(self, enabled=True, timeout=180):
        self.enabled = enabled
        self.timeout = timeout
        self.model = model_name()
        self.failed = False
        self.calls = 0

    def ask(self, img_bgr, prompt):
        """Return the model's short text answer, or None when disabled or unavailable."""
        if not self.enabled:
            return None
        png = encode_png(img_bgr)
        path = _cache_path(png, prompt, self.model)
        # Cached answers stay usable even after the live model has failed mid-run.
        if os.path.exists(path):
            with open(path, encoding='utf-8') as f:
                return json.load(f)['answer']
        if self.failed:
            return None
        body = {
            'model': self.model,
            'temperature': 0,
            'max_tokens': 400,
            'reasoning_effort': 'none',
            'messages': [{'role': 'user', 'content': [
                {'type': 'text', 'text': prompt},
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(png).decode()}},
            ]}],
        }
        req = urllib.request.Request(base_url() + '/chat/completions', data=json.dumps(body).encode('utf-8'),
                                     headers={'Content-Type': 'application/json',
                                              'Authorization': 'Bearer ollama'})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read())
            answer = (data['choices'][0]['message'].get('content') or '').strip()
        except Exception:
            # One failure disables the VLM for the rest of the run; clusters stay unknown.
            self.failed = True
            return None
        if not answer:
            return None  # an empty answer is a model hiccup, not something to remember
        self.calls += 1
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'answer': answer, 'model': self.model, 'prompt': prompt}, f)
        return answer

    def classify(self, img_bgr, prompt, choices):
        """Ask for one word from `choices`; returns the matching choice or None."""
        ans = self.ask(img_bgr, prompt)
        return match_choice(ans, choices)

    def yes_no(self, img_bgr, prompt):
        ans = self.ask(img_bgr, prompt)
        if ans is None:
            return None
        a = ans.strip().lower()
        if a.startswith('yes'):
            return True
        if a.startswith('no'):
            return False
        return None


SYNONYMS = {
    'palm': 'dense_vegetation', 'tree': 'dense_vegetation', 'forest': 'dense_vegetation',
    'bush': 'dense_vegetation', 'shrub': 'dense_vegetation', 'roof': 'building', 'house': 'building',
    'wall': 'building', 'water': 'water_shallow', 'ocean': 'water_deep', 'sea': 'water_deep',
    'deck': 'wood_floor', 'plank': 'wood_floor', 'wood': 'wood_floor', 'dock': 'wood_floor',
    'stone': 'stone_floor', 'floor': 'stone_floor', 'rock': 'rubble', 'gravel': 'rubble',
    'path': 'dirt', 'road': 'dirt', 'soil': 'dirt', 'marsh': 'mud', 'swamp': 'mud', 'snow': 'ice',
}


def match_choice(answer, choices):
    """Map a free-text answer onto one of the allowed words (longest match first, then synonyms)."""
    if not answer:
        return None
    a = answer.strip().lower().replace('-', '_').replace(' ', '_')
    for c in sorted(choices, key=len, reverse=True):
        if c in a:
            return c
    for word, target in SYNONYMS.items():
        if word in a and target in choices:
            return target
    return None
