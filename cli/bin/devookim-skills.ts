#!/usr/bin/env bun

import { main } from "../src/cli";

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
