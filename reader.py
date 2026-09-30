#!/usr/bin/env python3
"""
Reader - Markdown/LaTeX Reader CLI Tool
Replaces all bat/ps1 scripts with a unified command-line interface
"""

import argparse
import subprocess
import sys
import os
import socket
import webbrowser
import shutil
import time
import locale
from pathlib import Path
from typing import Optional, Tuple

# Fix Windows console encoding
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')
    # Enable ANSI escape codes on Windows 10+
    os.system('')


class Colors:
    """终端颜色"""
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'

    @staticmethod
    def is_supported() -> bool:
        """检查终端是否支持颜色"""
        if sys.platform == 'win32':
            # Windows 10+ 支持 ANSI
            try:
                os.system('')
                return True
            except:
                return False
        return hasattr(sys.stdout, 'isatty') and sys.stdout.isatty()


class ReaderCLI:
    """Reader CLI 主类"""

    def __init__(self):
        self.root = Path(__file__).parent.resolve()
        self.platform = sys.platform
        self.use_color = Colors.is_supported()

    def run(self) -> int:
        """运行 CLI"""
        parser = self.create_parser()
        args = parser.parse_args()

        if hasattr(args, 'func'):
            try:
                return args.func(args)
            except KeyboardInterrupt:
                self.print("\n\n操作已取消", Colors.YELLOW)
                return 130
            except Exception as e:
                self.print(f"\n错误: {e}", Colors.RED)
                return 1
        else:
            parser.print_help()
            return 0

    def create_parser(self) -> argparse.ArgumentParser:
        """创建参数解析器"""
        parser = argparse.ArgumentParser(
            prog='reader',
            description='Reader - Markdown/LaTeX 阅读器',
            formatter_class=argparse.RawDescriptionHelpFormatter,
            epilog="""
示例:
  python reader.py dev              启动开发服务器
  python reader.py dev --tauri      启动 Tauri 开发模式
  python reader.py build            构建前端
  python reader.py build --tauri    构建 Tauri exe
  python reader.py check            检查环境状态
  python reader.py open             打开浏览器
  python reader.py clean            清理构建缓存
  python reader.py install          安装依赖
"""
        )

        subparsers = parser.add_subparsers(dest='command', help='可用命令')

        # dev 命令
        dev_parser = subparsers.add_parser('dev', help='启动开发服务器')
        dev_parser.add_argument('--tauri', action='store_true', help='启动 Tauri 开发模式')
        dev_parser.add_argument('--port', type=int, default=5173, help='指定端口 (默认: 5173)')
        dev_parser.add_argument('--open', action='store_true', help='自动打开浏览器')
        dev_parser.set_defaults(func=self.cmd_dev)

        # build 命令
        build_parser = subparsers.add_parser('build', help='构建项目')
        build_parser.add_argument('--tauri', action='store_true', help='构建 Tauri exe')
        build_parser.add_argument('--clean', action='store_true', help='清理后构建')
        build_parser.set_defaults(func=self.cmd_build)

        # check 命令
        check_parser = subparsers.add_parser('check', help='检查环境状态')
        check_parser.add_argument('--server', action='store_true', help='检查服务器状态')
        check_parser.add_argument('--port', type=int, default=5173, help='服务器端口')
        check_parser.set_defaults(func=self.cmd_check)

        # open 命令
        open_parser = subparsers.add_parser('open', help='打开浏览器')
        open_parser.add_argument('--port', type=int, default=5173, help='端口号')
        open_parser.set_defaults(func=self.cmd_open)

        # clean 命令
        clean_parser = subparsers.add_parser('clean', help='清理构建缓存')
        clean_parser.add_argument('--all', action='store_true', help='清理所有缓存（包括 node_modules）')
        clean_parser.set_defaults(func=self.cmd_clean)

        # install 命令
        install_parser = subparsers.add_parser('install', help='安装依赖')
        install_parser.add_argument('--force', action='store_true', help='强制重新安装')
        install_parser.set_defaults(func=self.cmd_install)

        # icon 命令
        icon_parser = subparsers.add_parser('icon', help='生成应用图标')
        icon_parser.add_argument('source', nargs='?', help='源图标文件路径')
        icon_parser.set_defaults(func=self.cmd_icon)

        return parser

    # ==================== 工具方法 ====================

    def print(self, message: str, color: str = None, end: str = '\n'):
        """打印消息"""
        if self.use_color and color:
            print(f"{color}{message}{Colors.RESET}", end=end)
        else:
            print(message, end=end)

    def print_header(self, title: str):
        """打印标题"""
        self.print("\n" + "=" * 50, Colors.CYAN)
        self.print(f"  {title}", Colors.CYAN + Colors.BOLD)
        self.print("=" * 50, Colors.CYAN)
        self.print("")

    def print_step(self, step: int, total: int, message: str):
        """打印步骤"""
        self.print(f"[{step}/{total}] {message}", Colors.BLUE)

    def print_success(self, message: str):
        """打印成功消息"""
        self.print(f"✓ {message}", Colors.GREEN)

    def print_error(self, message: str):
        """打印错误消息"""
        self.print(f"✗ {message}", Colors.RED)

    def print_warning(self, message: str):
        """打印警告消息"""
        self.print(f"⚠ {message}", Colors.YELLOW)

    def print_info(self, message: str):
        """打印信息消息"""
        self.print(f"ℹ {message}", Colors.DIM)

    def run_command(self, cmd: str, cwd: Path = None, check: bool = True, capture: bool = False) -> Tuple[int, str]:
        """运行命令"""
        if cwd is None:
            cwd = self.root

        try:
            if capture:
                result = subprocess.run(
                    cmd, shell=True, cwd=cwd,
                    capture_output=True, text=True
                )
                return result.returncode, result.stdout.strip()
            else:
                result = subprocess.run(cmd, shell=True, cwd=cwd)
                return result.returncode, ""
        except FileNotFoundError:
            return 1, f"命令未找到: {cmd.split()[0]}"
        except Exception as e:
            return 1, str(e)

    def check_command(self, cmd: str) -> Tuple[bool, str]:
        """检查命令是否可用"""
        try:
            result = subprocess.run(
                cmd, shell=True,
                capture_output=True, text=True
            )
            return result.returncode == 0, result.stdout.strip()
        except:
            return False, ""

    def is_port_in_use(self, port: int) -> bool:
        """检查端口是否被占用"""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                return s.connect_ex(('localhost', port)) == 0
        except:
            return False

    def find_package_manager(self) -> str:
        """查找包管理器"""
        if shutil.which('pnpm'):
            return 'pnpm'
        elif shutil.which('npm'):
            return 'npm'
        else:
            raise RuntimeError("未找到 pnpm 或 npm，请先安装 Node.js")

    def ensure_dependencies(self) -> str:
        """确保依赖已安装，返回包管理器名称"""
        pkg = self.find_package_manager()

        if not (self.root / 'node_modules').exists():
            self.print("首次运行，正在安装依赖...", Colors.YELLOW)
            code, _ = self.run_command(f'{pkg} install')
            if code != 0:
                raise RuntimeError("依赖安装失败")
            self.print_success("依赖安装完成")

        return pkg

    # ==================== 命令实现 ====================

    def cmd_dev(self, args) -> int:
        """启动开发服务器"""
        self.print_header("Reader - 开发模式")

        # Tauri 开发模式
        if args.tauri:
            return self._dev_tauri(args)

        # 普通开发模式
        return self._dev_vite(args)

    def _dev_vite(self, args) -> int:
        """启动 Vite 开发服务器"""
        self.print_step(1, 2, "检查环境...")

        # 检查 Node.js
        ok, version = self.check_command('node --version')
        if not ok:
            self.print_error("未找到 Node.js")
            self.print_info("请安装 Node.js 18+: https://nodejs.org/")
            return 1
        self.print_success(f"Node.js: {version}")

        # 安装依赖
        self.print_step(2, 2, "检查依赖...")
        try:
            pkg = self.ensure_dependencies()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        self.print("")
        self.print("启动开发服务器...", Colors.CYAN)
        self.print(f"提示: 按 Ctrl+C 可停止服务器", Colors.DIM)
        self.print("")

        # 启动服务器
        code, _ = self.run_command(f'{pkg} dev')
        return code

    def _dev_tauri(self, args) -> int:
        """启动 Tauri 开发模式"""
        self.print_step(1, 3, "检查环境...")

        # 检查 Rust
        ok, version = self.check_command('rustc --version')
        if not ok:
            self.print_error("未找到 Rust")
            self.print_info("请安装 Rust: https://rustup.rs/")
            return 1
        self.print_success(f"Rust: {version}")

        # 检查 Node.js
        ok, version = self.check_command('node --version')
        if not ok:
            self.print_error("未找到 Node.js")
            return 1
        self.print_success(f"Node.js: {version}")

        # 安装依赖
        self.print_step(2, 3, "检查依赖...")
        try:
            pkg = self.ensure_dependencies()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        # 启动 Tauri
        self.print_step(3, 3, "启动 Tauri 开发模式...")
        self.print("")
        self.print("提示: 首次运行需要编译 Rust 代码，请耐心等待", Colors.YELLOW)
        self.print("")

        code, _ = self.run_command(f'{pkg} tauri dev')
        return code

    def cmd_build(self, args) -> int:
        """构建项目"""
        self.print_header("Reader - 构建项目")

        # 清理缓存
        if args.clean:
            self._clean_cache_for_build()

        # Tauri 构建
        if args.tauri:
            return self._build_tauri(args)

        # 前端构建
        return self._build_frontend(args)

    def _clean_cache_for_build(self):
        """清理构建缓存"""
        self.print("清理构建缓存...", Colors.YELLOW)

        # 清理 .svelte-kit
        svelte_kit = self.root / '.svelte-kit'
        if svelte_kit.exists():
            shutil.rmtree(svelte_kit)
            self.print_success("已清理 .svelte-kit")

        # 清理 build
        build_dir = self.root / 'build'
        if build_dir.exists():
            shutil.rmtree(build_dir)
            self.print_success("已清理 build")

        # 清理 Tauri target
        target_dir = self.root / 'src-tauri' / 'target'
        if target_dir.exists():
            shutil.rmtree(target_dir)
            self.print_success("已清理 src-tauri/target")

        self.print("")

    def _build_frontend(self, args) -> int:
        """构建前端"""
        self.print_step(1, 2, "检查环境...")

        # 检查 Node.js
        ok, version = self.check_command('node --version')
        if not ok:
            self.print_error("未找到 Node.js")
            return 1
        self.print_success(f"Node.js: {version}")

        # 安装依赖
        self.print_step(2, 2, "构建前端...")
        try:
            pkg = self.ensure_dependencies()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        self.print("")
        code, _ = self.run_command(f'{pkg} build')

        if code == 0:
            self.print_success("前端构建完成")
            self.print_info(f"输出目录: {self.root / 'build'}")

        return code

    def _build_tauri(self, args) -> int:
        """构建 Tauri exe"""
        self.print_step(1, 4, "检查环境...")

        # 检查 Rust
        ok, version = self.check_command('rustc --version')
        if not ok:
            self.print_error("未找到 Rust")
            self.print_info("请安装 Rust: https://rustup.rs/")
            return 1
        self.print_success(f"Rust: {version}")

        # 检查 Node.js
        ok, version = self.check_command('node --version')
        if not ok:
            self.print_error("未找到 Node.js")
            return 1
        self.print_success(f"Node.js: {version}")

        # 安装依赖
        self.print_step(2, 4, "检查依赖...")
        try:
            pkg = self.ensure_dependencies()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        # 生成图标
        self.print_step(3, 4, "检查图标...")
        icon_dir = self.root / 'src-tauri' / 'icons'
        if not (icon_dir / 'icon.ico').exists():
            self.print_warning("图标文件不存在，正在生成...")
            code, _ = self.run_command(f'{pkg} tauri icon src-tauri/icons/icon.svg')
            if code != 0:
                self.print_warning("图标生成失败，继续构建...")

        # 构建
        self.print_step(4, 4, "构建 Tauri exe...")
        self.print("")
        self.print("提示: 首次构建需要编译 Rust 代码，请耐心等待（约 10-20 分钟）", Colors.YELLOW)
        self.print("")

        code, _ = self.run_command(f'{pkg} tauri build')

        if code == 0:
            self.print_success("Tauri 构建完成")
            exe_path = self.root / 'src-tauri' / 'target' / 'release' / 'reader.exe'
            if exe_path.exists():
                self.print_info(f"可执行文件: {exe_path}")
            bundle_dir = self.root / 'src-tauri' / 'target' / 'release' / 'bundle'
            if bundle_dir.exists():
                self.print_info(f"安装包目录: {bundle_dir}")

        return code

    def cmd_check(self, args) -> int:
        """检查环境状态"""
        self.print_header("Reader - 环境检查")

        results = []

        # 检查 Node.js
        ok, version = self.check_command('node --version')
        if ok:
            self.print_success(f"Node.js: {version}")
            results.append(('Node.js', True, version))
        else:
            self.print_error("Node.js: 未安装")
            results.append(('Node.js', False, ''))

        # 检查 pnpm/npm
        ok, version = self.check_command('pnpm --version')
        if ok:
            self.print_success(f"pnpm: {version}")
            results.append(('pnpm', True, version))
        else:
            ok, version = self.check_command('npm --version')
            if ok:
                self.print_warning(f"npm: {version} (建议使用 pnpm)")
                results.append(('npm', True, version))
            else:
                self.print_error("包管理器: 未安装")
                results.append(('包管理器', False, ''))

        # 检查 Rust
        ok, version = self.check_command('rustc --version')
        if ok:
            self.print_success(f"Rust: {version}")
            results.append(('Rust', True, version))
        else:
            self.print_warning("Rust: 未安装 (Tauri 构建需要)")
            results.append(('Rust', False, ''))

        # 检查依赖
        if (self.root / 'node_modules').exists():
            self.print_success("依赖: 已安装")
            results.append(('依赖', True, ''))
        else:
            self.print_warning("依赖: 未安装")
            results.append(('依赖', False, ''))

        # 检查服务器状态
        if args.server or args.command == 'check':
            port = args.port if hasattr(args, 'port') else 5173
            if self.is_port_in_use(port):
                self.print_success(f"服务器: 运行中 (端口 {port})")
                results.append(('服务器', True, f'端口 {port}'))
            else:
                self.print_info(f"服务器: 未运行 (端口 {port})")
                results.append(('服务器', False, ''))

        # 显示总结
        self.print("\n" + "-" * 50, Colors.DIM)
        success_count = sum(1 for _, ok, _ in results if ok)
        total_count = len(results)

        if success_count == total_count:
            self.print(f"环境检查通过 ({success_count}/{total_count})", Colors.GREEN)
        else:
            self.print(f"环境检查 ({success_count}/{total_count})", Colors.YELLOW)

        return 0 if success_count >= 3 else 1  # 至少需要 Node.js + 包管理器 + 依赖

    def cmd_open(self, args) -> int:
        """打开浏览器"""
        port = args.port

        if not self.is_port_in_use(port):
            self.print_warning(f"服务器未运行 (端口 {port})")
            self.print_info("请先启动开发服务器: python reader.py dev")
            return 1

        url = f"http://localhost:{port}"
        self.print(f"打开浏览器: {url}", Colors.CYAN)
        webbrowser.open(url)

        return 0

    def cmd_clean(self, args) -> int:
        """清理构建缓存"""
        self.print_header("Reader - 清理缓存")

        cleaned = []

        # 清理 .svelte-kit
        svelte_kit = self.root / '.svelte-kit'
        if svelte_kit.exists():
            shutil.rmtree(svelte_kit)
            cleaned.append('.svelte-kit')
            self.print_success("已清理 .svelte-kit")

        # 清理 build
        build_dir = self.root / 'build'
        if build_dir.exists():
            shutil.rmtree(build_dir)
            cleaned.append('build')
            self.print_success("已清理 build")

        # 清理 Tauri target
        target_dir = self.root / 'src-tauri' / 'target'
        if target_dir.exists():
            if args.all:
                shutil.rmtree(target_dir)
                cleaned.append('src-tauri/target')
                self.print_success("已清理 src-tauri/target")
            else:
                self.print_info("跳过 src-tauri/target (使用 --all 清理)")

        # 清理 node_modules
        if args.all:
            node_modules = self.root / 'node_modules'
            if node_modules.exists():
                shutil.rmtree(node_modules)
                cleaned.append('node_modules')
                self.print_success("已清理 node_modules")

        if cleaned:
            self.print(f"\n已清理: {', '.join(cleaned)}", Colors.GREEN)
        else:
            self.print_info("没有需要清理的缓存")

        return 0

    def cmd_install(self, args) -> int:
        """安装依赖"""
        self.print_header("Reader - 安装依赖")

        # 检查包管理器
        try:
            pkg = self.find_package_manager()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        self.print_success(f"包管理器: {pkg}")

        # 强制重新安装
        if args.force:
            node_modules = self.root / 'node_modules'
            if node_modules.exists():
                self.print("删除 node_modules...", Colors.YELLOW)
                shutil.rmtree(node_modules)

        # 安装依赖
        self.print("正在安装依赖...", Colors.CYAN)
        code, _ = self.run_command(f'{pkg} install')

        if code == 0:
            self.print_success("依赖安装完成")
        else:
            self.print_error("依赖安装失败")

        return code

    def cmd_icon(self, args) -> int:
        """生成应用图标"""
        self.print_header("Reader - 生成图标")

        # 检查源文件
        source = args.source
        if source:
            source_path = Path(source)
            if not source_path.exists():
                self.print_error(f"源文件不存在: {source}")
                return 1
        else:
            # 默认使用 SVG
            source_path = self.root / 'src-tauri' / 'icons' / 'icon.svg'
            if not source_path.exists():
                self.print_error("未找到图标源文件")
                self.print_info("请提供图标文件: python reader.py icon <path>")
                return 1

        # 检查 Tauri CLI
        try:
            pkg = self.find_package_manager()
        except RuntimeError as e:
            self.print_error(str(e))
            return 1

        self.print(f"源文件: {source_path}", Colors.CYAN)
        self.print("正在生成图标...", Colors.CYAN)

        code, _ = self.run_command(f'{pkg} tauri icon {source_path}')

        if code == 0:
            self.print_success("图标生成完成")
            self.print_info(f"输出目录: {self.root / 'src-tauri' / 'icons'}")
        else:
            self.print_error("图标生成失败")

        return code


def main():
    """主函数"""
    cli = ReaderCLI()
    sys.exit(cli.run())


if __name__ == '__main__':
    main()
