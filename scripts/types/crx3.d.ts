// crx3 2.0.0 ships no declarations. This describes the file-list API used by pack-crx.ts,
// verified against lib/writeCRX3File.js and lib/configuration.js in the installed package.
declare module "crx3" {
  export default function crx3(
    files: string[],
    options: { keyPath: string; crxPath: string; zipPath: string },
  ): Promise<{ appId: string; crxPath: string; zipPath: string }>;
}
