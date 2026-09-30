use regex::{Regex, RegexBuilder};
use serde::Serialize;

pub fn matcher(query: &str, case_sensitive: bool, use_regex: bool, whole_word: bool) -> Result<Regex, String> {
    let mut pattern = if use_regex { query.to_owned() } else { regex::escape(query) };
    if whole_word { pattern = format!(r"\b(?:{})\b", pattern); }
    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|error| format!("Invalid search expression: {}", error))
}

#[derive(Serialize)]
pub struct ReplacementPreview {
    pub content: String,
    pub count: usize,
}

const MAX_OUTPUT: usize = 8 * 1024 * 1024;

fn append(output: &mut String, value: &str) -> Result<(), String> {
    if output.len().saturating_add(value.len()) > MAX_OUTPUT {
        return Err("Replacement exceeds the 8 MiB output limit".into());
    }
    output.push_str(value);
    Ok(())
}

// Directory search is line-based. Preserve line endings and the same anchor semantics.
#[tauri::command]
pub fn preview_replacement(
    text: String, query: String, replacement: String,
    case_sensitive: bool, use_regex: bool, whole_word: bool,
) -> Result<ReplacementPreview, String> {
    if text.len() > 2 * 1024 * 1024 || replacement.len() > 16 * 1024 {
        return Err("Replacement preview supports files up to 2 MiB and replacement text up to 16 KiB".into());
    }
    if query.is_empty() { return Err("Search expression cannot be empty".into()); }
    let regex = matcher(&query, case_sensitive, use_regex, whole_word)?;
    let mut content = String::new();
    let mut count = 0;
    for part in text.split_inclusive('\n') {
        let (line, ending) = if let Some(line) = part.strip_suffix("\r\n") { (line, "\r\n") }
            else if let Some(line) = part.strip_suffix('\n') { (line, "\n") }
            else { (part, "") };
        let mut previous = 0;
        for captures in regex.captures_iter(line) {
            count += 1;
            if count > 100_000 { return Err("Too many matches; narrow the search first".into()); }
            let found = captures.get(0).expect("full match always exists");
            append(&mut content, &line[previous..found.start()])?;
            if use_regex {
                let largest_capture = captures.iter().flatten().map(|m| m.as_str().len()).max().unwrap_or(0);
                if replacement.len().saturating_mul(largest_capture.saturating_add(1)) > MAX_OUTPUT {
                    return Err("Capture expansion exceeds the preview safety limit".into());
                }
                let mut expanded = String::new();
                captures.expand(&replacement, &mut expanded);
                append(&mut content, &expanded)?;
            } else {
                append(&mut content, &replacement)?;
            }
            previous = found.end();
        }
        append(&mut content, &line[previous..])?;
        append(&mut content, ending)?;
    }
    Ok(ReplacementPreview { content, count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_crlf_and_line_anchors() {
        let result = preview_replacement("a\r\nb\r\n".into(), "^".into(), ">".into(), true, true, false).unwrap();
        assert_eq!(result.content, ">a\r\n>b\r\n");
        assert_eq!(result.count, 2);
    }

    #[test]
    fn literal_replacement_does_not_expand_dollars() {
        let result = preview_replacement("a a".into(), "a".into(), "$1".into(), true, false, false).unwrap();
        assert_eq!(result.content, "$1 $1");
    }

    #[test]
    fn shares_unicode_word_boundaries_and_capture_syntax() {
        let result = preview_replacement("猫 猫咪".into(), "(?P<name>猫)".into(), "${name}!".into(), true, true, true).unwrap();
        assert_eq!(result.content, "猫! 猫咪");
        assert_eq!(result.count, 1);
        assert!(matcher("(?<=a)b", true, true, false).is_err());
    }
}
