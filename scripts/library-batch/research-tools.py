"""Bounded PDF acquisition and selected-page rendering for one research job."""

import argparse
import hashlib
import ipaddress
import json
import math
import pathlib
import socket
import ssl
import sys
import urllib.parse
import urllib.request


ROOT = pathlib.Path.cwd().resolve()
REFS = ROOT / "references"
MAX_RENDER_PIXELS = 12_000_000


def clip_coordinates(value):
    try:
        rect = tuple(float(number) for number in value.split(","))
    except ValueError as error:
        raise argparse.ArgumentTypeError("Clip needs four finite PDF-point coordinates") from error
    if len(rect) != 4 or not all(math.isfinite(number) for number in rect):
        raise argparse.ArgumentTypeError("Clip needs four finite PDF-point coordinates")
    if rect[0] >= rect[2] or rect[1] >= rect[3]:
        raise argparse.ArgumentTypeError("Clip coordinates must increase: x0 < x1 and y0 < y1")
    return rect


def render_region(page_rect, clip, dpi):
    bounds = tuple(page_rect)
    rect = clip if clip is not None else bounds
    if not all(math.isfinite(number) for number in bounds):
        raise ValueError("Page rectangle must be finite")
    if not (bounds[0] <= rect[0] < rect[2] <= bounds[2]
            and bounds[1] <= rect[1] < rect[3] <= bounds[3]):
        raise ValueError("Clip must lie within the selected page rectangle")
    scaled = [number * dpi / 72 for number in rect]
    if not all(math.isfinite(number) for number in scaled):
        raise ValueError("Render exceeds the 12 million pixel limit")
    # Enclose fractional pixel edges before PyMuPDF allocates its pixmap.
    width = math.ceil(scaled[2]) - math.floor(scaled[0])
    height = math.ceil(scaled[3]) - math.floor(scaled[1])
    if width * height > MAX_RENDER_PIXELS:
        raise ValueError("Render exceeds the 12 million pixel limit; use a smaller clip or lower DPI")
    return rect, width, height


def local_file(value):
    target = (ROOT / value).resolve()
    if not target.is_relative_to(REFS.resolve()):
        raise ValueError("Document paths must stay inside references/")
    return target


def public_https(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username:
        raise ValueError("A public HTTPS document URL is required")
    for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443):
        if not ipaddress.ip_address(item[4][0]).is_global:
            raise ValueError("Private or local addresses are not document sources")
    return url


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def pdf_runtime():
    config = json.loads((ROOT / "job.json").read_text())
    runtime = config.get("pdfModulePath")
    if runtime:
        sys.path.insert(0, runtime)
    import pymupdf
    return pymupdf


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch", help="Download a PDF or page; extract PDF text")
    fetch.add_argument("url")
    fetch.add_argument("name", help="Simple filename inside references/, e.g. manual.pdf")
    render = commands.add_parser("render", help="Render selected one-based physical PDF pages")
    render.add_argument("file", help="references/manual.pdf")
    render.add_argument("--pages", required=True, help="Comma-separated pages, e.g. 2,7,8")
    render.add_argument("--dpi", type=int, default=120)
    render.add_argument("--clip", type=clip_coordinates,
                        help="x0,y0,x1,y1 in PDF page points (72 points/inch), within each selected page rectangle")
    args = parser.parse_args()
    REFS.mkdir(exist_ok=True)
    if args.command == "fetch":
        if pathlib.Path(args.name).name != args.name:
            raise ValueError("Use a simple filename")
        target = local_file("references/" + args.name)
        context = ssl.create_default_context()
        try:
            import certifi
            context.load_verify_locations(certifi.where())
        except ImportError:
            pass
        opener = urllib.request.build_opener(
            CheckedRedirect(), urllib.request.HTTPSHandler(context=context)
        )
        request = urllib.request.Request(public_https(args.url), headers={"User-Agent": "Thermite component research/0.1"})
        with opener.open(request, timeout=45) as response:
            data = response.read(64 * 1024 * 1024 + 1)
            if len(data) > 64 * 1024 * 1024:
                raise ValueError("Document exceeds 64 MiB acquisition limit")
            metadata = {"url": args.url, "resolvedURL": response.url, "contentType": response.headers.get("Content-Type"), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        target.write_bytes(data)
        if data.startswith(b"%PDF-"):
            doc = pdf_runtime().open(target)
            metadata["pages"] = len(doc)
            text_path = target.with_suffix(".txt")
            text_path.write_text("\n".join(f"\n=== PHYSICAL PDF PAGE {i + 1} ===\n{page.get_text(sort=True)}" for i, page in enumerate(doc)))
            metadata["textFile"] = str(text_path.relative_to(ROOT))
        target.with_suffix(target.suffix + ".metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(json.dumps({"file": str(target.relative_to(ROOT)), **metadata}))
    else:
        pages = [int(p) for p in args.pages.split(",")]
        maximum_dpi = 600 if args.clip is not None else 180
        if len(pages) > 12 or not 72 <= args.dpi <= maximum_dpi:
            raise ValueError("Render at most 12 selected pages at 72–180 DPI, or 72–600 DPI with --clip")
        source = local_file(args.file)
        fitz = pdf_runtime()
        with fitz.open(source) as doc:
            plans = []
            for number in pages:
                if not 1 <= number <= len(doc):
                    raise ValueError("Page outside document")
                rect, width, height = render_region(doc[number - 1].rect, args.clip, args.dpi)
                plans.append((number, rect, width, height))
            # Validate every selected page before creating any output.
            for number, rect, width, height in plans:
                suffix = ""
                if args.clip is not None:
                    suffix = "-clip-" + "_".join(format(n, ".12g") for n in rect) + f"-{args.dpi}dpi"
                output = source.with_name(f"{source.stem}-page-{number}{suffix}.png")
                pixmap = doc[number - 1].get_pixmap(
                    matrix=fitz.Matrix(args.dpi / 72, args.dpi / 72),
                    clip=fitz.Rect(rect) if args.clip is not None else None,
                )
                pixmap.save(output)
                metadata = {"source": str(source.relative_to(ROOT)), "page": number,
                            "image": str(output.relative_to(ROOT)), "rect": rect,
                            "dpi": args.dpi, "clipped": args.clip is not None,
                            "width": pixmap.width, "height": pixmap.height,
                            "pixelUpperBound": width * height}
                output.with_suffix(".png.metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
                print(json.dumps(metadata))


if __name__ == "__main__":
    main()
