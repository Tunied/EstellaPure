p = 'D:/estella/tools/render-lab/build_lab.py'
s = open(p, encoding='utf8', newline='').read()
i = s.index("def finish(img, name):")
j = s.index("if lab.startswith('balls'):")
new = '''def load_png(rgba, name):
    path = os.path.join(os.path.dirname(os.path.abspath(out)), name + '.png')
    write_png(path, rgba)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'sRGB'
    img.pack()
    return img


def stripes_image(name, size, period, duty, dark, bright, alpha_cut):
    """Vertical strands, `period` texels apart: bright in the middle of each, dark at its edge; with `alpha_cut` the gaps are clear."""
    x = np.arange(size)
    phase = (x % period) / period
    prof = 0.5 + 0.5 * np.cos(2 * np.pi * (phase - 0.5))                 # 1 at the strand's centre, 0 at its edge
    col = dark + (bright - dark) * prof
    alpha = np.where(np.abs(phase - 0.5) < duty / 2, 1.0, 0.0) if alpha_cut else np.ones(size)
    row = np.stack([col, col, col, alpha], axis=1)
    return load_png(np.tile(row[None, :, :], (size, 1, 1)), name)


def ramp_image(name, size):
    x = np.linspace(0.05, 0.95, size)
    row = np.stack([x, x, x, np.ones(size)], axis=1)
    return load_png(np.tile(row[None, :, :], (size, 1, 1)), name)


'''
s = s[:i] + new + s[j:]
s = s.replace("import lab_specs as S  # noqa: E402\n", "import lab_specs as S  # noqa: E402\nfrom lab_png import write_png  # noqa: E402\n", 1)
open(p, 'w', encoding='utf8', newline='').write(s)
print('ok')
