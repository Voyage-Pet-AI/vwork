import { Box, Text } from "ink";
import type { ConnectedService } from "./types.js";

interface HeaderProps {
  services: ConnectedService[];
}

export function Header({ services }: HeaderProps) {
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>Reporter</Text>
        {services.length > 0 && (
          <Text dimColor>
            {services.map((s) => s.name).join(" · ")}
          </Text>
        )}
      </Box>
    </Box>
  );
}
