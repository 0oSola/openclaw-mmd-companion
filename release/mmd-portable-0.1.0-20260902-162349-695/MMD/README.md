# Local MMD Assets

This directory is intentionally kept out of the open-source repository by
default. The application scans `MMD_ROOT_DIR` for local PMX/PMD models,
textures, toon files, SPA/SPH files, VMD motions, and audio files at runtime.

The MIT license at the repository root covers the source code and project
documentation only. It does not grant rights to third-party character models,
game assets, textures, motion packs, voice clips, music, screenshots, or other
media placed in this directory.

Before publishing, redistributing, or sharing any files under `MMD/`, verify
the original asset terms. Unless an asset license explicitly says otherwise,
treat local demo assets as non-commercial and non-redistributable. Several
common MMD model and motion packages prohibit redistribution, commercial use,
extraction of parts, or use outside MMD.

Recommended local layout:

```text
MMD/
  MyModel/
    model.pmx
    textures/
      body.png
  usage/
    vmd/
      MyModel[actions]/
        00_idle_loop/
          idle.vmd
```

Keep each model package's relative file layout exactly as provided by the
original author so texture and toon references continue to resolve.
