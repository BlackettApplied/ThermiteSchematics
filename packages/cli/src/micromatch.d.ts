declare module "micromatch" {
  const micromatch: {
    isMatch(
      input: string,
      patterns: string | readonly string[],
      options?: { dot?: boolean; nocase?: boolean },
    ): boolean;
  };
  export default micromatch;
}
