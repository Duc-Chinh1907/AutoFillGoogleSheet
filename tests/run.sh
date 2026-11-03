#!/bin/sh
# Chạy test bằng JavaScriptCore có sẵn trên macOS.
cd "$(dirname "$0")/.." || exit 1
exec /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc tests/test.js
