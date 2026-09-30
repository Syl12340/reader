#!/usr/bin/env python3
"""
build.py — 项目一键构建脚本

功能:
- 运行 `pnpm build`（前端）
- 可选运行 `pnpm tauri build`（原生）并支持设置 `CARGO_TARGET_DIR`

用法示例:
  python scripts/build.py --frontend --tauri --no-bundle
  python scripts/build.py --tauri --cargo-target-dir D:\\my_target

注意: 需要已安装 `pnpm` 且在 PATH 中可用。
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd, cwd=None, env=None):
    # cmd: list or string
    display = cmd if isinstance(cmd, str) else ' '.join(cmd)
    print(f">>> Running: {display} (cwd={cwd})")
    try:
        # 如果能够解析到可执行文件路径，则使用完整路径执行，避免 Windows 可执行解析问题
        if isinstance(cmd, list):
            exe_path = shutil.which(cmd[0])
            if exe_path:
                cmd = [exe_path] + cmd[1:]

        # 在 Windows 上若找不到可执行，使用 shell 回退（例如 pnpm 可能是脚本/别名）
        if os.name == 'nt' and isinstance(cmd, list) and shutil.which(cmd[0]) is None:
            return subprocess.run(' '.join(cmd), cwd=cwd, env=env, check=True, shell=True).returncode

        completed = subprocess.run(cmd, cwd=cwd, env=env, check=True)
        return completed.returncode
    except subprocess.CalledProcessError as e:
        print(f"Command failed with exit code {e.returncode}")
        return e.returncode
    except FileNotFoundError as e:
        print(f"Executable not found: {e}")
        return 127


def main():
    parser = argparse.ArgumentParser(description='Build frontend and (optionally) tauri native')
    parser.add_argument('--no-frontend', action='store_true', help='跳过前端构建 (pnpm build)')
    parser.add_argument('--no-tauri', action='store_true', help='跳过 Tauri 构建')
    parser.add_argument('--no-bundle', action='store_true', help='传递 --no-bundle 给 pnpm tauri build')
    parser.add_argument('--cargo-target-dir', type=str, default=None, help='为 Cargo 指定目标目录 (CARGO_TARGET_DIR)')
    parser.add_argument('--cwd', type=str, default=None, help='在指定目录执行命令（默认为项目根）')
    args = parser.parse_args()

    # 解析项目根
    script_path = Path(__file__).resolve()
    project_root = Path(args.cwd).resolve() if args.cwd else script_path.parents[1]

    # 检查 pnpm（若未在 PATH 中也不立即退出，后续会尝试 shell 回退）
    if shutil.which('pnpm') is None:
        print('Warning: pnpm 未在 PATH 中找到。脚本将尝试通过 shell 回退执行 pnpm 命令。')

    env = os.environ.copy()
    if args.cargo_target_dir:
        env['CARGO_TARGET_DIR'] = str(Path(args.cargo_target_dir).resolve())
        print(f"Set CARGO_TARGET_DIR={env['CARGO_TARGET_DIR']}")
    else:
        # 默认使用项目内 target 目录，和之前手动成功的做法一致
        default_target = project_root / 'target'
        env['CARGO_TARGET_DIR'] = str(default_target)
        print(f"Defaulting CARGO_TARGET_DIR={env['CARGO_TARGET_DIR']}")

    exit_code = 0

    # 前端构建
    if not args.no_frontend:
        print('\n=== Frontend: pnpm build ===')
        exit_code = run(['pnpm', 'build'], cwd=str(project_root), env=env)
        if exit_code != 0:
            print('Frontend build failed.')
            sys.exit(exit_code)

    # Tauri 构建
    if not args.no_tauri:
        print('\n=== Tauri: pnpm tauri build ===')
        cmd = ['pnpm', 'tauri', 'build']
        if args.no_bundle:
            cmd.append('--no-bundle')
        exit_code = run(cmd, cwd=str(project_root), env=env)
        if exit_code != 0:
            print('Tauri build failed.')
            sys.exit(exit_code)

    print('\nAll done. Build succeeded.')


if __name__ == '__main__':
    main()
