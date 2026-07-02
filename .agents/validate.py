import sys
import json
import subprocess
import os
import re
import logging
import traceback

# Get directory of this script to place the log file next to it
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "validate.log")

# Setup logger
logger = logging.getLogger("validate")
logger.setLevel(logging.DEBUG)

# File handler (append mode is default)
if not logger.handlers:
    try:
        fh = logging.FileHandler(LOG_FILE, encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
        fh.setFormatter(formatter)
        logger.addHandler(fh)
    except Exception as e:
        sys.stderr.write(f"Failed to set up logging to {LOG_FILE}: {e}\n")

def log_and_print_decision(decision_dict):
    output_json = json.dumps(decision_dict)
    logger.info(f"Decision output: {output_json}")
    print(output_json)

def extract_prompt_from_transcript(transcript_path):
    if not transcript_path:
        return None
    transcript_path = os.path.expanduser(transcript_path)
    if not os.path.exists(transcript_path):
        return None
    try:
        user_inputs = []
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    step = json.loads(line)
                    if step.get("type") == "USER_INPUT":
                        user_inputs.append(step)
                except Exception:
                    continue
        if user_inputs:
            last_input = user_inputs[-1]
            content = last_input.get("content", "")
            match = re.search(r"<USER_REQUEST>(.*?)</USER_REQUEST>", content, re.DOTALL)
            if match:
                return match.group(1).strip()
            return content.strip()
    except Exception as e:
        logger.exception("Error parsing transcript:")
        sys.stderr.write(f"Error parsing transcript: {e}\n")
    return None

def main():
    # Check for SKIP_HOOKS env var at the beginning and shortcircuit
    skip_hooks_env = os.environ.get("SKIP_HOOKS")
    logger.info(f"SKIP_HOOKS environment variable: {skip_hooks_env}")
    if skip_hooks_env == "true":
        log_and_print_decision({"decision": "stop"})
        return

    try:
        stdin_text = sys.stdin.read()
        logger.info(f"Received stdin payload (first 1000 chars): {stdin_text[:1000]}")
        logger.debug(f"Full stdin payload: {stdin_text}")
    except Exception as e:
        logger.exception("Failed to read stdin:")
        # If we can't read stdin, stop to avoid getting stuck
        log_and_print_decision({"decision": "stop"})
        return

    try:
        payload = json.loads(stdin_text)
    except Exception as e:
        logger.exception("Failed to parse stdin payload JSON:")
        # If we can't parse input, allow stop to avoid getting stuck
        log_and_print_decision({"decision": "stop"})
        return

    # Determine workspace directory
    workspace_paths = payload.get("workspacePaths")
    workspace_dir = workspace_paths[0] if workspace_paths and len(workspace_paths) > 0 else os.getcwd()
    logger.info(f"Workspace directory determined as: {workspace_dir}")

    # Log payload for debugging purposes
    try:
        debug_path = os.path.join(workspace_dir, ".agents", "last_payload.json")
        with open(debug_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        logger.info(f"Successfully wrote payload to debug path: {debug_path}")
    except Exception as e:
        logger.warning(f"Failed to write last_payload.json to {workspace_dir}: {e}")

    # Only run validation when a prompt has been addressed (model_stop)
    termination_reason = payload.get("terminationReason")
    logger.info(f"Termination reason: {termination_reason}")
    if termination_reason != "model_stop":
        log_and_print_decision({"decision": "stop"})
        return

    commands = [
        {"name": "npm run build", "cmd": "npm run build"},
        {"name": "npm run test", "cmd": "npm run test"},
        {"name": "npm run lint", "cmd": "npm run lint"}
    ]

    for command in commands:
        logger.info(f"Executing command: {command['name']} ('{command['cmd']}')")
        try:
            res = subprocess.run(
                command["cmd"],
                shell=True,
                cwd=workspace_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            status = res.returncode
            stdout = res.stdout
            stderr = res.stderr
            error_msg = ""
        except Exception as e:
            status = -1
            stdout = ""
            stderr = ""
            error_msg = str(e)
            logger.exception(f"Exception executing command {command['name']}:")

        logger.info(f"Command '{command['name']}' returned code: {status}")
        if stdout:
            logger.info(f"Command '{command['name']}' stdout:\n{stdout}")
        if stderr:
            logger.info(f"Command '{command['name']}' stderr:\n{stderr}")
        if error_msg:
            logger.error(f"Command '{command['name']}' error message: {error_msg}")

        if status != 0 or error_msg:
            output = f'Command "{command["name"]}" failed.\n{error_msg}\n\n--- Standard Output ---\n{stdout or ""}\n\n--- Standard Error ---\n{stderr or ""}'
            
            log_and_print_decision({
                "decision": "continue",
                "reason": f"Verification failed during Stop hook:\n\n{output}\n\nPlease resolve the issues above before finishing."
            })
            return

    # Step: Invoke agy with a non-interactive prompt to identify gaps
    prompt = payload.get("prompt")
    if not prompt:
        prompt = payload.get("userInput")
    if not prompt:
        prompt = payload.get("input")
    if not prompt:
        prompt = payload.get("instruction")
    if not prompt:
        prompt = extract_prompt_from_transcript(payload.get("transcriptPath"))

    if not prompt:
        prompt = "No prompt found in hook metadata"

    logger.info(f"Extracted user prompt for gap analysis: {prompt}")

    agy_prompt = f"Explore the implementation of the given prompt and identify gaps. If no gaps are identified, print nothing. Prompt: {prompt}"

    # Setup environment with SKIP_HOOKS=true
    sub_env = os.environ.copy()
    sub_env["SKIP_HOOKS"] = "true"

    logger.info(f"Invoking agy gap analysis command...")
    try:
        res = subprocess.run(
            ["agy", "--model", "gemini-3.1-pro", "--dangerously-skip-permissions", "--print", agy_prompt],
            cwd=workspace_dir,
            env=sub_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        status = res.returncode
        agy_stdout = res.stdout.strip() if res.stdout else ""
        agy_stderr = res.stderr if res.stderr else ""
        
        logger.info(f"agy execution returned code: {status}")
        if agy_stdout:
            logger.info(f"agy stdout:\n{agy_stdout}")
        if agy_stderr:
            logger.info(f"agy stderr:\n{agy_stderr}")

        if agy_stdout:
            log_and_print_decision({
                "decision": "continue",
                "reason": f"Gaps identified in implementation:\n\n{agy_stdout}\n\nPlease address these gaps before finishing."
            })
            return
    except Exception as e:
        logger.exception("Failed to run agy:")
        sys.stderr.write(f"Failed to run agy: {e}\n")

    # All checks passed
    log_and_print_decision({"decision": "stop"})

if __name__ == "__main__":
    # Print delimiter at the beginning of each call
    logger.info("\n" + "=" * 80 + f"\nVALIDATION HOOK CALL STARTED (PID: {os.getpid()})\n" + "=" * 80)
    try:
        main()
    except Exception as e:
        logger.exception("Unhandled exception in validation script:")
        log_and_print_decision({"decision": "stop"})
