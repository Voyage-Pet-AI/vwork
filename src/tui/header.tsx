import { Box, Text } from "ink";
import type { ConnectedService } from "./types.js";

interface HeaderProps {
  services: ConnectedService[];
  todoCounts?: {
    active: number;
    blocked: number;
  };
}

export function Header({ services, todoCounts }: HeaderProps) {
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>Reporter</Text>
        <Box>
          {todoCounts && (
            <Text dimColor>
              [{todoCounts.active} active] [{todoCounts.blocked} blocked]{"  "}
            </Text>
          )}
          {services.length > 0 && (
            <Text dimColor>
              {services.map((s) => s.name).join(" · ")}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
