import os
import json
import re
import time
import random
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

BASE_URL = "https://www.dndbeyond.com"

class RequestLimitExceeded(Exception):
    """Raised when the maximum number of network requests for the session is reached."""
    pass

class ScraperManager:
    def __init__(
        self,
        cache_dir,
        state_file,
        validate_asset_fn,
        offline=False,
        force=False,
        reset_state=False,
        max_requests=1000,
        request_delay_min=5,
        request_delay_max=30
    ):
        self.cache_dir = cache_dir
        self.state_file = state_file
        self.validate_asset_fn = validate_asset_fn  # Callback: (html, url) -> (is_valid, source_name)
        self.offline = offline
        self.force = force
        self.reset_state = reset_state
        self.max_requests = max_requests
        self.request_delay_min = request_delay_min
        self.request_delay_max = request_delay_max
        
        self.requests_made = 0
        self.playwright_context = None
        self.browser = None
        self.context = None
        self.page = None
        
        self._load_state()

    def _load_state(self):
        self.state = {"last_page": 1, "blocked_sources": [], "unowned_urls": []}
        if not self.reset_state and os.path.exists(self.state_file):
            with open(self.state_file, 'r', encoding='utf-8') as f:
                self.state = json.load(f)
            if "unowned_urls" not in self.state:
                self.state["unowned_urls"] = []
        if self.force:
            self.state["last_page"] = 1

    def save_state(self):
        os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
        with open(self.state_file, 'w', encoding='utf-8') as f:
            json.dump(self.state, f, indent=2)

    def get_page(self):
        if self.page is None:
            self.playwright_context = sync_playwright().start()
            try:
                print("Connecting to Chrome via remote debugging port 9222...")
                self.browser = self.playwright_context.chromium.connect_over_cdp("http://127.0.0.1:9222")
                self.context = self.browser.contexts[0]
                for existing_page in self.context.pages:
                    if existing_page.url == "about:blank" or "dndbeyond.com" in existing_page.url:
                        self.page = existing_page
                        break
                if not self.page:
                    self.page = self.context.pages[-1] if self.context.pages else self.context.new_page()
            except Exception as e:
                print(f"Failed to connect to Chrome. Error: {e}")
                raise e
        return self.page

    def close_playwright(self):
        if self.page:
            try: self.page.close()
            except: pass
            self.page = None
        if self.browser:
            try: self.browser.close()
            except: pass
            self.browser = None
        if self.playwright_context:
            try: self.playwright_context.stop()
            except: pass
            self.playwright_context = None

    def fetch_html(self, url, wait_time=2000):
        if self.offline:
            print(f"Offline mode: Skipping fetch for {url}")
            return ""
            
        if self.requests_made >= self.max_requests:
            raise RequestLimitExceeded("Network request limit reached.")
            
        print(f"Fetching {url}...")
        p_page = self.get_page()
        p_page.goto(url)
        p_page.wait_for_timeout(wait_time)
        html = p_page.content()
        self.requests_made += 1
        
        delay = self.request_delay_min + random.uniform(0, self.request_delay_max - self.request_delay_min)
        print(f"Sleeping for {delay:.2f} seconds... (Requests made: {self.requests_made})")
        time.sleep(delay)
        return html

    def get_list_page(self, url, page_number):
        page_filepath = os.path.join(self.cache_dir, f"page{page_number}.html")
        if os.path.exists(page_filepath):
            print(f"Found cached list page {page_number}, skipping web request...")
            with open(page_filepath, 'r', encoding='utf-8') as f:
                return f.read()
                
        if self.offline:
            print(f"Offline mode: List page {page_number} not cached.")
            return None

        html = self.fetch_html(url, wait_time=2000)
        
        if "just a moment" in html.lower() and "cloudflare" in html.lower():
            print("Cloudflare block detected! Please solve it in the Chrome browser window.")
            time.sleep(15)
            p_page = self.get_page()
            html = p_page.content()

        os.makedirs(os.path.dirname(page_filepath), exist_ok=True)
        with open(page_filepath, 'w', encoding='utf-8') as f:
            f.write(html)
        return html

    def get_asset_html(self, slug, url, known_source=None):
        # 1. Check if URL is blacklisted in state
        if url in self.state.get("unowned_urls", []):
            return None

        # 2. Check cache directories for existing file
        local_filepath = None
        if known_source:
            safe_source = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '', known_source).strip()
            local_filepath = os.path.join(self.cache_dir, safe_source, f"{slug}.html")
            if os.path.exists(local_filepath):
                with open(local_filepath, 'r', encoding='utf-8') as f:
                    return f.read()

        # Fallback: scan all subfolders recursively to find the cached file
        for root, dirs, files in os.walk(self.cache_dir):
            if "details" in root:  # Skip legacy details folders
                continue
            potential_path = os.path.join(root, f"{slug}.html")
            if os.path.exists(potential_path):
                with open(potential_path, 'r', encoding='utf-8') as f:
                    return f.read()

        # 3. Fetch from web
        if self.offline:
            print(f"Offline mode: Skipping '{slug}' (not cached)")
            return None

        html_content = self.fetch_html(url)
        if not html_content:
            return None

        # 4. Validate ownership using the callback
        is_valid, parsed_source = self.validate_asset_fn(html_content, url)
        
        if is_valid:
            # Owned item: cache HTML under source subdirectory
            safe_source = re.sub(r'[<>:"/\\|?*\x00-\x1F]', '', parsed_source).strip()
            local_dir = os.path.join(self.cache_dir, safe_source)
            target_path = os.path.join(local_dir, f"{slug}.html")
            os.makedirs(local_dir, exist_ok=True)
            with open(target_path, 'w', encoding='utf-8') as f:
                f.write(html_content)
            return html_content
        else:
            # Check for deterministic redirect/locked signatures
            soup = BeautifulSoup(html_content, 'html.parser')
            title_text = soup.find('title').get_text(strip=True) if soup.find('title') else ""
            is_redirected = "Marketplace" in title_text or "Shop" in title_text or "What's inside" in title_text or "Choose Your Plan" in title_text
            has_lock_text = soup.find(string=re.compile(r'unlock this content|purchase the', re.I)) is not None
            is_known_locked_state = is_redirected or has_lock_text or "marketplace" in url.lower() or "store" in url.lower()

            if is_known_locked_state:
                print(f"Verified locked/unowned content. Skipping and blacklisting URL.")
                if url not in self.state["unowned_urls"]:
                    self.state["unowned_urls"].append(url)
                return None
            else:
                raise RuntimeError(
                    f"Parsing failed: missing valid blocks, but title ('{title_text}') "
                    "does not match expected locked/marketplace redirect signatures. "
                    "Possible Cloudflare challenge page or network error."
                )
