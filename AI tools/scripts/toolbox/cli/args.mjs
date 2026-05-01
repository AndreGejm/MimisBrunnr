export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {
    json: true,
    markdown: false,
    ignore: [],
    include: []
  };
  const positional = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }

    const flag = value.slice(2);
    if (["json", "markdown", "dry-run"].includes(flag)) {
      flags[flag.replace("-", "")] = true;
      if (flag === "markdown") {
        flags.json = false;
      }
      continue;
    }

    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[flag] = true;
      continue;
    }

    index += 1;
    if (flag === "ignore" || flag === "include") {
      flags[flag].push(next);
    } else {
      flags[flag] = next;
    }
  }

  return { command, flags, positional };
}
