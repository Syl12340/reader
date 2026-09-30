#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::*;
#[cfg(windows)]
use windows::core::{implement, HRESULT, PCWSTR, Result as WinResult};

fn main() {
    println!("Hello");
}
