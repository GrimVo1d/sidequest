"""The sidequest:// scheme: DLC pages and the SDK, served to the window from inside the app.

A DLC loaded from file:// shares the hub's origin and could reach the hub page and its
bridge. Served as sidequest://app/dlc/<id>/..., in a sandboxed frame, it is another
origin. WebKit asks a handler in this process for every file; there is no port, no
server and no network. Only files under the given roots are served, read-only.
"""

import os
import sys
import urllib.parse
from typing import Any

from . import paths

SCHEME = "sidequest"
ORIGIN = SCHEME + "://app"
MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".gif": "image/gif",
}


def url_for(path: str) -> str:
    """The sidequest:// URL of a file in the project."""
    rel = os.path.relpath(os.path.abspath(path), paths.PROJECT_DIR)
    return ORIGIN + "/" + urllib.parse.quote(rel.replace(os.sep, "/"))


def resolve(url: str, roots: list[str]) -> str | None:
    """The file a sidequest:// URL names, or None unless it is a file of a known type
    inside one of `roots` (symlinks and ".." are resolved before the check)."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != SCHEME or parts.netloc != "app":
        return None
    rel = urllib.parse.unquote(parts.path).lstrip("/")
    path = os.path.realpath(os.path.join(paths.PROJECT_DIR, rel))
    if os.path.splitext(path)[1] not in MIME_TYPES or not os.path.isfile(path):
        return None
    for root in roots:
        real_root = os.path.realpath(root)
        if os.path.commonpath([path, real_root]) == real_root:
            return path
    return None


def read(url: str, roots: list[str]) -> tuple[int, str, bytes]:
    """(HTTP status, content type, body) for a request from the window."""
    path = resolve(url, roots)
    if path is None:
        return 404, "text/plain", b""
    with open(path, "rb") as f:
        return 200, MIME_TYPES[os.path.splitext(path)[1]], f.read()


_roots: list[str] = []
_installed = False


def install(roots: list[str]) -> None:
    """Register the scheme on every WKWebView pywebview creates from now on (macOS)."""
    global _installed
    _roots[:] = roots
    if _installed or sys.platform != "darwin":  # other systems: PLAN.md, cross-platform
        return
    import objc
    import WebKit
    from Foundation import NSData, NSHTTPURLResponse, NSObject
    from webview.platforms import cocoa

    class SidequestSchemeHandler(NSObject, protocols=[objc.protocolNamed("WKURLSchemeHandler")]):  # type: ignore[call-arg]
        def webView_startURLSchemeTask_(self, webview: Any, task: Any) -> None:  # noqa: N802
            url = task.request().URL()
            status, mime, body = read(str(url.absoluteString()), _roots)
            headers = {"Content-Type": mime, "Cache-Control": "no-store"}
            response = NSHTTPURLResponse.alloc().initWithURL_statusCode_HTTPVersion_headerFields_(
                url, status, "HTTP/1.1", headers
            )
            task.didReceiveResponse_(response)
            task.didReceiveData_(NSData.dataWithBytes_length_(body, len(body)))
            task.didFinish()

        def webView_stopURLSchemeTask_(self, webview: Any, task: Any) -> None:  # noqa: N802
            pass  # every task finishes inside start

    handler = SidequestSchemeHandler.alloc().init()

    class Configuration:
        """Stands for WKWebViewConfiguration in `WKWebViewConfiguration.alloc().init()`."""

        def alloc(self) -> "Configuration":
            return self

        def init(self) -> Any:
            config = WebKit.WKWebViewConfiguration.alloc().init()
            config.setURLSchemeHandler_forURLScheme_(handler, SCHEME)
            return config

    class WebKitWithScheme:
        """pywebview's WebKit module, but its web views get the scheme. Neither class can
        be patched instead: pywebview's methods call super(BrowserView.WebKitHost, ...),
        and PyObjC does not reach WKWebView's init from a method replaced in place."""

        WKWebViewConfiguration = Configuration()

        def __getattr__(self, name: str) -> Any:
            return getattr(WebKit, name)

    cocoa.WebKit = WebKitWithScheme()
    _installed = True
