#!/usr/bin/env bun
import { runThermite } from "./alpha.js";
process.exitCode = await runThermite();
