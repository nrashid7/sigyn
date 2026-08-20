export function requireServerEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function hasServerEnv(...names: string[]) {
  return names.every((name) => Boolean(process.env[name]));
}
