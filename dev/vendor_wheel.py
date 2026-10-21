"""Build vendor/proxy_tools-0.1.0-py3-none-any.whl from the release on PyPI.

pywebview needs proxy_tools, which PyPI has only as source. Installing it from source makes
pip build it, and to build it pip fetches the newest setuptools with no hash and runs it, so
not every file of an install would be pinned. This wheel holds the release's one module and
its metadata, taken from the source archive whose hash is fixed below; nothing of the
archive is run. requirements.txt installs the wheel by its own hash (dev/hashes.py).

    .venv/bin/python dev/vendor_wheel.py
"""

import base64
import hashlib
import io
import os
import sys
import tarfile
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, VERSION = "proxy_tools", "0.1.0"
SDIST_URL = "https://files.pythonhosted.org/packages/source/p/proxy_tools/proxy_tools-0.1.0.tar.gz"
SDIST_SHA256 = "ccb3751f529c047e2d8a58440d86b205303cf0fe8146f784d1cbcd94f0a28010"
WHEEL = os.path.join(ROOT, "vendor", f"{NAME}-{VERSION}-py3-none-any.whl")
# The same bytes on every run: a fixed time and mode for every entry.
DATE = (1980, 1, 1, 0, 0, 0)


def sdist() -> bytes:
    with urllib.request.urlopen(SDIST_URL, timeout=30) as response:
        data: bytes = response.read()
    if hashlib.sha256(data).hexdigest() != SDIST_SHA256:
        raise SystemExit("the source archive on PyPI is not the one pinned")
    return data


def module_and_info(data: bytes) -> tuple[bytes, bytes]:
    """The module and PKG-INFO, read from the archive without unpacking it."""
    prefix = f"{NAME}-{VERSION}/"
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:

        def read(name: str) -> bytes:
            member = archive.extractfile(prefix + name)
            if member is None:
                raise SystemExit(f"{name} is not a file in the archive")
            return member.read()

        return read(f"{NAME}/__init__.py"), read("PKG-INFO")


def metadata(pkg_info: bytes) -> bytes:
    """PKG-INFO's fields under a Metadata-Version that wheels take."""
    lines = [b"Metadata-Version: 2.1"]
    lines += [line for line in pkg_info.splitlines() if not line.startswith(b"Metadata-Version")]
    return b"\n".join(lines) + b"\n"


def record_line(path: str, data: bytes) -> str:
    digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    return f"{path},sha256={digest},{len(data)}"


def build(module: bytes, pkg_info: bytes) -> bytes:
    info = f"{NAME}-{VERSION}.dist-info"
    files = {
        f"{NAME}/__init__.py": module,
        f"{info}/METADATA": metadata(pkg_info),
        f"{info}/WHEEL": (
            b"Wheel-Version: 1.0\nGenerator: sidequest dev/vendor_wheel.py\n"
            b"Root-Is-Purelib: true\nTag: py3-none-any\n"
        ),
        f"{info}/top_level.txt": f"{NAME}\n".encode(),
    }
    record = [record_line(path, data) for path, data in files.items()]
    files[f"{info}/RECORD"] = ("\n".join([*record, f"{info}/RECORD,,"]) + "\n").encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as wheel:
        for path, data in files.items():
            entry = zipfile.ZipInfo(path, DATE)
            entry.external_attr = 0o644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            wheel.writestr(entry, data)
    return out.getvalue()


def main() -> int:
    module, pkg_info = module_and_info(sdist())
    os.makedirs(os.path.dirname(WHEEL), exist_ok=True)
    with open(WHEEL, "wb") as f:
        f.write(build(module, pkg_info))
    print(f"{os.path.relpath(WHEEL, ROOT)}: built; now run dev/hashes.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
