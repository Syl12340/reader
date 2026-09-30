#!/usr/bin/env python3
"""
extract_source.py — 项目源代码提取脚本

将项目核心源码抽取为单一文本文件，方便交给 AI 进行错误分析。

输出内容:
  - 项目结构树
  - 所有关键源码文件内容（前端 + Rust 后端 + 配置文件）

用法:
  python scripts/extract_source.py                      # 输出到 stdout
  python scripts/extract_source.py -o source_dump.txt   # 输出到文件
  python scripts/extract_source.py --compact             # 精简模式（去除空行和注释）
"""

import argparse
import os
import sys
from pathlib import Path


# ── 需要提取的文件扩展名 ──
FRONTEND_EXTS = {'.svelte', '.ts', '.js', '.css'}
RUST_EXTS = {'.rs'}
CONFIG_FILES = {
    'tauri.conf.json',
    'Cargo.toml',
    'vite.config.ts',
    'svelte.config.js',
    'tailwind.config.js',
    'package.json',
    'postcss.config.js',
    'tsconfig.json',
}

# ── 排除的目录 ──
EXCLUDE_DIRS = {
    'node_modules', '.svelte-kit', 'target', 'build',
    '.git', '.claude', 'dist', '__pycache__',
}

# ── 排除的文件 ──
EXCLUDE_FILES = {
    'pnpm-lock.yaml',
    '.DS_Store',
}

# ── 文件大小上限（字节）──
MAX_FILE_SIZE = 100_000


def should_skip_dir(dirname: str) -> bool:
    return dirname in EXCLUDE_DIRS or dirname.startswith('.')


def should_include_file(filepath: Path, project_root: Path) -> bool:
    """判断文件是否应被提取"""
    name = filepath.name
    if name in EXCLUDE_FILES:
        return False
    if filepath.stat().st_size > MAX_FILE_SIZE:
        return False

    rel = filepath.relative_to(project_root)

    # 配置文件：在项目根目录下
    if rel.parent == Path('.') and name in CONFIG_FILES:
        return True

    # 前端源码：src/ 下
    if str(rel).startswith('src' + os.sep) or str(rel) == 'src':
        return filepath.suffix in FRONTEND_EXTS

    # Rust 后端：src-tauri/src/ 下
    if str(rel).startswith('src-tauri' + os.sep + 'src' + os.sep):
        return filepath.suffix in RUST_EXTS

    # Tauri 配置：src-tauri/ 下
    if str(rel).startswith('src-tauri' + os.sep):
        if name in {'Cargo.toml', 'tauri.conf.json', 'build.rs'}:
            return True
        if name.endswith('.json') and 'capabilities' in str(rel):
            return True

    # scripts/ 下的构建脚本
    if str(rel).startswith('scripts' + os.sep):
        return filepath.suffix == '.py'

    return False


def collect_files(project_root: Path) -> list[Path]:
    """递归收集需要提取的文件"""
    files = []
    for dirpath, dirnames, filenames in os.walk(project_root):
        # 过滤目录（原地修改 dirnames 以跳过）
        dirnames[:] = [d for d in dirnames if not should_skip_dir(d)]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            if should_include_file(fpath, project_root):
                files.append(fpath)

    # 按路径排序
    files.sort(key=lambda p: str(p.relative_to(project_root)))
    return files


def build_tree(project_root: Path, files: list[Path]) -> str:
    """生成目录树"""
    lines = []
    lines.append(f"{project_root.name}/")

    # 按目录分组
    dirs: dict[str, list[str]] = {}
    for f in files:
        rel = f.relative_to(project_root)
        parts = list(rel.parts)
        if len(parts) > 1:
            dir_key = '/'.join(parts[:-1])
            dirs.setdefault(dir_key, []).append(parts[-1])
        else:
            dirs.setdefault('.', []).append(parts[0])

    # 排序并输出
    for dir_path in sorted(dirs.keys()):
        if dir_path != '.':
            lines.append(f"├── {dir_path}/")
        for fname in sorted(dirs[dir_path]):
            prefix = "│   " if dir_path != '.' else ""
            lines.append(f"{prefix}├── {fname}")

    return '\n'.join(lines)


def compact_content(content: str) -> str:
    """精简模式：去除多余空行和纯注释行"""
    result_lines = []
    prev_empty = False
    for line in content.split('\n'):
        stripped = line.strip()
        # 跳过连续空行
        if not stripped:
            if not prev_empty:
                result_lines.append('')
                prev_empty = True
            continue
        prev_empty = False
        result_lines.append(line)
    return '\n'.join(result_lines).strip()


def extract(project_root: Path, compact: bool = False) -> str:
    """主提取逻辑"""
    files = collect_files(project_root)

    output_parts = []

    # ── 头部 ──
    output_parts.append("=" * 72)
    output_parts.append("  SOURCE CODE DUMP")
    output_parts.append(f"  Project: {project_root.name}")
    output_parts.append(f"  Files:   {len(files)}")
    output_parts.append("=" * 72)
    output_parts.append("")

    # ── 目录树 ──
    output_parts.append("## PROJECT STRUCTURE")
    output_parts.append("-" * 40)
    output_parts.append(build_tree(project_root, files))
    output_parts.append("")
    output_parts.append("")

    # ── 文件内容 ──
    for i, fpath in enumerate(files):
        rel = fpath.relative_to(project_root)
        try:
            content = fpath.read_text(encoding='utf-8')
        except (UnicodeDecodeError, PermissionError):
            output_parts.append(f"## FILE: {rel}")
            output_parts.append(f"[SKIPPED: binary or unreadable]")
            output_parts.append("")
            continue

        if compact:
            content = compact_content(content)

        lang = {
            '.svelte': 'svelte',
            '.ts': 'typescript',
            '.js': 'javascript',
            '.css': 'css',
            '.rs': 'rust',
            '.json': 'json',
            '.toml': 'toml',
            '.py': 'python',
        }.get(fpath.suffix, '')

        output_parts.append(f"## FILE: {rel}")
        output_parts.append(f"```{lang}")
        output_parts.append(content)
        output_parts.append("```")
        output_parts.append("")

    return '\n'.join(output_parts)


def main():
    parser = argparse.ArgumentParser(description='Extract project source code for AI analysis')
    parser.add_argument('-o', '--output', type=str, default=None, help='Output file path (default: stdout)')
    parser.add_argument('--compact', action='store_true', help='Compact mode: remove blank lines and comments')
    parser.add_argument('--root', type=str, default=None, help='Project root directory (default: script parent)')
    args = parser.parse_args()

    # 解析项目根
    if args.root:
        project_root = Path(args.root).resolve()
    else:
        project_root = Path(__file__).resolve().parents[1]

    if not project_root.exists():
        print(f"Error: project root not found: {project_root}", file=sys.stderr)
        sys.exit(1)

    result = extract(project_root, compact=args.compact)

    if args.output:
        out_path = Path(args.output)
        out_path.write_text(result, encoding='utf-8')
        print(f"Written to {out_path} ({len(result)} bytes)", file=sys.stderr)
    else:
        print(result)


if __name__ == '__main__':
    main()
