"""Fetch the pinned official npm distribution and verify its published integrity."""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

VERSION = "6.4.299"
root = Path(__file__).resolve().parents[1]
target = root / "vendor" / "pdfjs"
with urllib.request.urlopen(f"https://registry.npmjs.org/pdfjs-dist/{VERSION}") as response:
    metadata = json.load(response)
url = metadata["dist"]["tarball"]
if not url.startswith("https://registry.npmjs.org/pdfjs-dist/-/"):
    raise RuntimeError("Unexpected distribution URL")
with urllib.request.urlopen(url) as response:
    archive = response.read()
integrity = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode()
if integrity != metadata["dist"]["integrity"]:
    raise RuntimeError("Distribution integrity mismatch")
count = 0
with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
    for member in package.getmembers():
        if not member.isfile() or not member.name.startswith("package/"):
            continue
        name = member.name.removeprefix("package/")
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError("Unsafe archive path")
        selected = name in {"LICENSE", "build/pdf.min.mjs", "build/pdf.worker.min.mjs"}
        selected |= name.startswith(("cmaps/", "standard_fonts/", "wasm/", "iccs/")) and not name.endswith(".map")
        if selected:
            output = target.joinpath(*relative.parts)
            if not output.resolve().is_relative_to(target.resolve()):
                raise RuntimeError("Unsafe destination")
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(package.extractfile(member).read())
            count += 1
target.mkdir(parents=True, exist_ok=True)
(target / "distribution.json").write_text(json.dumps({"name":"pdfjs-dist", "version":VERSION, "source":url, "integrity":integrity}, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"version":VERSION,"files":count,"verified":True}))
