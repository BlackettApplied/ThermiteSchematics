#!/usr/bin/env node
import { runThermite } from "./alpha.js";
process.exitCode = await runThermite();
