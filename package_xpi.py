import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
INCLUDE = ['LICENSE', 'NOTICE', 'manifest.json', 'bootstrap.js', 'build-info.js', 'schedule.js', 'discovery.js', 'annotation-image.js', 'fsrs-adapter.js', 'queue-policy.js', 'unit-maintenance.js', 'prefs.js', 'content', 'vendor']
EXCLUDED_TOP_LEVEL = {'scripts', 'docs', 'dist', 'tests', 'node_modules'}


def source_version() -> str:
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    version = package['version']
    if manifest['version'] != version:
        raise RuntimeError(f"manifest version {manifest['version']} does not match package version {version}; run npm run version:sync")
    return version


def add_directory(archive: zipfile.ZipFile, path: Path) -> None:
    name = path.relative_to(ROOT).as_posix().rstrip('/') + '/'
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.create_version = 30
    info.extract_version = 10
    info.external_attr = 0o040755 << 16
    info.compress_type = zipfile.ZIP_STORED
    archive.writestr(info, b'', compress_type=zipfile.ZIP_STORED)


def add_file(archive: zipfile.ZipFile, path: Path) -> None:
    name = path.relative_to(ROOT).as_posix()
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    info.create_version = 30
    info.extract_version = 20
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)


def main() -> None:
    version = source_version()
    DIST.mkdir(exist_ok=True)
    output = DIST / f'zotero-review-tab-{version}.xpi'
    if output.exists():
        output.unlink()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=False) as archive:
        for entry in INCLUDE:
            target = ROOT / entry
            if not target.exists():
                raise RuntimeError(f'Missing release input: {entry}')
            if target.is_file():
                add_file(archive, target)
                continue
            add_directory(archive, target)
            for path in sorted(target.rglob('*')):
                if path.is_dir():
                    add_directory(archive, path)
                elif path.is_file():
                    add_file(archive, path)
    with zipfile.ZipFile(output, 'r') as archive:
        names = set(archive.namelist())
        required = {'LICENSE', 'NOTICE', 'vendor/ts-fsrs-LICENSE', 'vendor/ts-fsrs-PROVENANCE.md', 'content/review-tab.js', 'content/review-tab.css', 'content/preferences.js', 'content/preferences.xhtml', 'manifest.json', 'bootstrap.js', 'build-info.js', 'schedule.js', 'discovery.js', 'annotation-image.js', 'fsrs-adapter.js', 'queue-policy.js', 'unit-maintenance.js', 'prefs.js', 'vendor/ts-fsrs-5.4.2.umd.js'}
        if archive.testzip() is not None or not required.issubset(names):
            raise RuntimeError('XPI archive verification failed')
        if any(name.split('/')[0] in EXCLUDED_TOP_LEVEL for name in names):
            raise RuntimeError('XPI contains development-only files')
    print(output)


if __name__ == '__main__':
    main()
