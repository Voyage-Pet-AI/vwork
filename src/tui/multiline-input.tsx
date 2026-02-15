import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

interface MultiLineInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
  disableVerticalNav?: boolean;
}

function cursorPosition(value: string, offset: number): { line: number; col: number } {
  const lines = value.split("\n");
  let remaining = offset;
  for (let i = 0; i < lines.length; i++) {
    if (remaining <= lines[i].length) {
      return { line: i, col: remaining };
    }
    remaining -= lines[i].length + 1; // +1 for the \n
  }
  // Fallback: end of last line
  return { line: lines.length - 1, col: lines[lines.length - 1].length };
}

function offsetFromPosition(value: string, line: number, col: number): number {
  const lines = value.split("\n");
  const clampedLine = Math.max(0, Math.min(line, lines.length - 1));
  const clampedCol = Math.max(0, Math.min(col, lines[clampedLine].length));
  let offset = 0;
  for (let i = 0; i < clampedLine; i++) {
    offset += lines[i].length + 1;
  }
  return offset + clampedCol;
}

export function MultiLineInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  disableVerticalNav = false,
}: MultiLineInputProps) {
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const cursorManagedRef = useRef(false);

  // When value changes externally (autocomplete, clear), move cursor to end
  useEffect(() => {
    if (!cursorManagedRef.current) {
      setCursorOffset(value.length);
    }
    cursorManagedRef.current = false;
  }, [value]);

  useInput(
    (input, key) => {
      // Skip keys we don't handle
      if (key.escape || key.tab || (key.ctrl && input === "c")) return;

      // Enter → submit
      if (key.return) {
        onSubmit(value);
        return;
      }

      // Ctrl+J → insert newline (terminal sends \n for Ctrl+J)
      if (input === "\n") {
        const before = value.slice(0, cursorOffset);
        const after = value.slice(cursorOffset);
        cursorManagedRef.current = true;
        onChange(before + "\n" + after);
        setCursorOffset(cursorOffset + 1);
        return;
      }

      // Left arrow
      if (key.leftArrow) {
        setCursorOffset((o) => Math.max(0, o - 1));
        return;
      }

      // Right arrow
      if (key.rightArrow) {
        setCursorOffset((o) => Math.min(value.length, o + 1));
        return;
      }

      // Up arrow — move cursor to previous line
      if (key.upArrow && !disableVerticalNav) {
        const { line, col } = cursorPosition(value, cursorOffset);
        if (line > 0) {
          setCursorOffset(offsetFromPosition(value, line - 1, col));
        }
        return;
      }

      // Down arrow — move cursor to next line
      if (key.downArrow && !disableVerticalNav) {
        const lines = value.split("\n");
        const { line, col } = cursorPosition(value, cursorOffset);
        if (line < lines.length - 1) {
          setCursorOffset(offsetFromPosition(value, line + 1, col));
        }
        return;
      }

      // Backspace / delete
      if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          const before = value.slice(0, cursorOffset - 1);
          const after = value.slice(cursorOffset);
          cursorManagedRef.current = true;
          onChange(before + after);
          setCursorOffset(cursorOffset - 1);
        }
        return;
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        const before = value.slice(0, cursorOffset);
        const after = value.slice(cursorOffset);
        cursorManagedRef.current = true;
        onChange(before + input + after);
        setCursorOffset(cursorOffset + input.length);
      }
    },
    { isActive: focus }
  );

  // Rendering
  const lines = value.split("\n");
  const { line: cursorLine, col: cursorCol } = cursorPosition(value, cursorOffset);

  // Empty value with focus → show placeholder with cursor
  if (!value && focus) {
    return (
      <Box flexDirection="column">
        <Text>
          {placeholder ? (
            <>
              <Text>{chalk.inverse(placeholder[0])}</Text>
              <Text dimColor>{placeholder.slice(1)}</Text>
            </>
          ) : (
            <Text>{chalk.inverse(" ")}</Text>
          )}
        </Text>
      </Box>
    );
  }

  // Empty value without focus → just placeholder
  if (!value) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{placeholder}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>
          {i === cursorLine && focus ? (
            cursorCol < line.length ? (
              <>
                {line.slice(0, cursorCol)}
                {chalk.inverse(line[cursorCol])}
                {line.slice(cursorCol + 1)}
              </>
            ) : (
              <>
                {line}
                {chalk.inverse(" ")}
              </>
            )
          ) : (
            line || " " // render empty lines as a space to preserve height
          )}
        </Text>
      ))}
    </Box>
  );
}
