use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct FileError {
    pub code: &'static str,
    pub message: String,
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        let code = if cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33)) {
            "busy"
        } else {
            match error.kind() {
                io::ErrorKind::NotFound => "not_found",
                io::ErrorKind::PermissionDenied => "permission_denied",
                io::ErrorKind::Interrupted | io::ErrorKind::WouldBlock => "busy",
                io::ErrorKind::InvalidData => "invalid_data",
                _ => "io_error",
            }
        };
        Self { code, message: error.to_string() }
    }
}

#[cfg(test)]
pub fn write_text(path: &Path, content: &str, expected: Option<&str>) -> Result<(), FileError> {
    write_bytes_guarded(path, content.as_bytes(), expected.map(str::as_bytes), false)
}

pub fn write_bytes(path: &Path, content: &[u8], expected: Option<&[u8]>) -> Result<(), FileError> {
    write_bytes_guarded(path, content, expected, false)
}

pub fn write_text_guarded(path: &Path, content: &str, expected: Option<&str>, expected_missing: bool) -> Result<(), FileError> {
    write_bytes_guarded(path, content.as_bytes(), expected.map(str::as_bytes), expected_missing)
}

pub fn write_bytes_guarded(path: &Path, content: &[u8], expected: Option<&[u8]>, expected_missing: bool) -> Result<(), FileError> {
    let _lock = WRITE_LOCK.lock().map_err(|_| FileError {
        code: "io_error", message: "File write lock unavailable".into(),
    })?;
    // Resolve existing symlinks so saving updates their target, not the link itself.
    let target = match fs::canonicalize(path) {
        Ok(target) => target,
        Err(error) if error.kind() == io::ErrorKind::NotFound && expected.is_none() => path.to_path_buf(),
        Err(error) => return Err(error.into()),
    };
    let metadata = match fs::metadata(&target) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound && expected.is_none() => None,
        Err(error) => return Err(error.into()),
    };
    if expected_missing && metadata.is_some() {
        return Err(FileError { code: "conflict", message: "Save target was created after it was selected".into() });
    }
    if metadata.as_ref().is_some_and(|value| value.permissions().readonly()) {
        return Err(FileError { code: "permission_denied", message: "File is read-only".into() });
    }
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let (temp_path, mut temp) = loop {
        let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".reader-write-{}-{}.tmp", std::process::id(), id));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => break (candidate, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    };
    let result = (|| -> Result<(), FileError> {
        temp.write_all(content)?;
        if let Some(metadata) = metadata { temp.set_permissions(metadata.permissions())?; }
        temp.sync_all()?;
        drop(temp);
        // Serialize Reader writers and reject stale replacement previews just before commit.
        if let Some(expected) = expected {
            if fs::read(&target)?.as_slice() != expected {
                return Err(FileError { code: "conflict", message: "File changed since replacement preview".into() });
            }
        }
        if expected_missing && target.exists() {
            return Err(FileError { code: "conflict", message: "Save target was created before the write completed".into() });
        }
        replace_file(&temp_path, &target)?;
        #[cfg(unix)]
        if let Ok(directory) = fs::File::open(parent) { let _ = directory.sync_all(); }
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp_path); }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<(), FileError> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};

    let source = HSTRING::from(source.as_os_str());
    let target = HSTRING::from(target.as_os_str());
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(target.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }.map_err(|error| io::Error::from_raw_os_error(error.code().0).into())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<(), FileError> {
    fs::rename(source, target).map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir().join(format!("reader-file-test-{}-{}-{}", std::process::id(), stamp, TEMP_ID.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&dir).unwrap();
            Self(dir)
        }
        fn file(&self) -> PathBuf { self.0.join("note.md") }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_file(self.file());
            let _ = fs::remove_dir(&self.0);
        }
    }

    #[test]
    fn stale_baseline_keeps_original_and_cleans_temporary_file() {
        let fixture = Fixture::new();
        fs::write(fixture.file(), "external edit").unwrap();
        let error = write_text(&fixture.file(), "replacement", Some("old text")).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read_to_string(fixture.file()).unwrap(), "external edit");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn successful_save_replaces_complete_content() {
        let fixture = Fixture::new();
        write_text(&fixture.file(), "before", None).unwrap();
        write_text(&fixture.file(), "after", Some("before")).unwrap();
        assert_eq!(fs::read_to_string(fixture.file()).unwrap(), "after");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn deleted_file_is_not_recreated_by_a_stale_save() {
        let fixture = Fixture::new();
        let error = write_text(&fixture.file(), "after", Some("before")).unwrap_err();
        assert_eq!(error.code, "not_found");
        assert!(!fixture.file().exists());
    }

    #[test]
    fn existing_target_is_replaced_without_leaving_a_temporary_file() {
        let fixture = Fixture::new();
        fs::write(fixture.file(), b"old").unwrap();
        write_bytes_guarded(&fixture.file(), b"new", Some(b"old"), false).unwrap();
        assert_eq!(fs::read(fixture.file()).unwrap(), b"new");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn newly_created_save_as_target_is_not_overwritten() {
        let fixture = Fixture::new();
        fs::write(fixture.file(), b"external").unwrap();
        let error = write_bytes_guarded(&fixture.file(), b"ours", None, true).unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(fs::read(fixture.file()).unwrap(), b"external");
    }
}
