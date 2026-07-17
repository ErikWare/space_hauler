#!/usr/bin/env python3
"""Generate a sprite via the xAI grok-imagine-image API using the OAuth token from ~/.grok/auth.json.

The auth file stores credentials under a namespaced key, e.g.:
    { "https://auth.x.ai::<client-id>": { "key": "<jwt access token>", ... } }
so get_token() digs the JWT out of that structure (with fallbacks for the
flatter { "access_token" | "token": ... } shape).
"""
import sys, json, base64, subprocess, pathlib, time
import requests

AUTH_FILE = pathlib.Path.home() / ".grok/auth.json"
API_URL = "https://api.x.ai/v1/images/generations"


def get_token():
    data = json.loads(AUTH_FILE.read_text())
    # Flat shapes first.
    if isinstance(data, dict):
        if data.get("access_token"):
            return data["access_token"]
        if data.get("token"):
            return data["token"]
        # Namespaced OIDC shape: { "<issuer>::<client>": { "key": "<jwt>", ... } }
        for v in data.values():
            if isinstance(v, dict):
                tok = v.get("key") or v.get("access_token") or v.get("token")
                if tok:
                    return tok
    raise RuntimeError(f"Could not find an access token in {AUTH_FILE}")


def generate(prompt: str, out_path: str, model="grok-imagine-image", retries=3):
    token = get_token()
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(
                API_URL,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"model": model, "prompt": prompt, "n": 1},
                timeout=120,
            )
            resp.raise_for_status()
            data = resp.json()
            item = data["data"][0]
            if item.get("b64_json"):
                img_bytes = base64.b64decode(item["b64_json"])
                pathlib.Path(out_path).write_bytes(img_bytes)
            elif item.get("url"):
                img = requests.get(item["url"], timeout=120)
                img.raise_for_status()
                pathlib.Path(out_path).write_bytes(img.content)
            else:
                raise RuntimeError(f"Unexpected response shape: {list(item.keys())}")
            # Normalize to a true PNG regardless of source format.
            subprocess.run(
                ["sips", "-s", "format", "png", out_path, "--out", out_path],
                capture_output=True,
            )
            size = pathlib.Path(out_path).stat().st_size
            print(f"✅ {out_path} ({size} bytes)")
            return True
        except Exception as e:
            last_err = e
            body = ""
            if isinstance(e, requests.HTTPError) and e.response is not None:
                body = f" | status={e.response.status_code} body={e.response.text[:300]}"
            print(f"⚠️  attempt {attempt}/{retries} failed for {out_path}: {e}{body}")
            if attempt < retries:
                time.sleep(5 * attempt)
    print(f"❌ FAILED {out_path}: {last_err}")
    return False


if __name__ == "__main__":
    generate(sys.argv[1], sys.argv[2])
