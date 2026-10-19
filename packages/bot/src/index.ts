import process from "node:process";
import { main } from "./main.ts";

process.stdout.write(`${main()}\n`);
