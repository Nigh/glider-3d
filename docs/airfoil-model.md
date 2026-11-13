# Selectable airfoils and the PR #56 wind-tunnel follow-up

Implements [comment 6846417676](https://github.com/Nigh/glider-3d/pull/56#issuecomment-6846417676) and [review 5888778464](https://github.com/Nigh/glider-3d/pull/56#pullrequestreview-5888778464). Physics version: `extended-airfoils-v23`; older recordings/scores remain isolated by the existing version check.

## Candidate and source assessment

NACA 63(2)-615 and 63(3)-018 are relevant high-Re candidates, but a name or section drawing alone does not supply the CL/CD/alpha/Re tables and transition conditions needed by this model. This change selects **NACA 0012** because a reproducible public experimental table can be checked row by row. This is a choice of a traceable initial option, not a claim that 63-series measurements do not exist or that 0012 is optimal for these aircraft.

Sources, with the downloaded numeric source files retained in `data/airfoils/`:

| Input | Conditions | Use |
| --- | --- | --- |
| [NASA TMR NACA 0012 validation](https://tmbwg.github.io/turbmodels/naca0012_val.html), [Ladson CL/CD table](https://tmbwg.github.io/turbmodels/NACA0012_validation/CLCD_Ladson_expdata.dat) | NASA TM 4074 (1988), Re=6 million, M=0.15, transition tripped | Only the **80-grit** positive-alpha branch, including the measured stall drop; do not mix grit zones |
| [NASA report catalogue](https://ntrs.nasa.gov/citations/19880019495) | Ladson's original report identity | Bibliographic reference; the report PDF was not used as an additional numerical source |
| [AirfoilTools 200k CSV](http://airfoiltools.com/polar/csv?polar=xf-n0012-il-200000), [1M CSV](http://airfoiltools.com/polar/csv?polar=xf-n0012-il-1000000) | XFOIL, Ncrit=9, M=0 | Low-Re **predictions**, not experiments |
| [DAE-11 coordinates](http://airfoiltools.com/airfoil/seligdatfile?airfoil=dae11-il) | UIUC coordinate file mirrored by AirfoilTools | DAE-11 upper/lower render, hinge and contact ordinates |

Regenerate the checked-in `src/airfoil-data.json` without network access:

```sh
node scripts/import-airfoils.mjs
```

The importer preserves the positive-alpha measurements. It adds a symmetric-model zero-lift anchor `(0°, CL=0, CD=.00809)` using the nearest measured drag at −.05°, and the runtime mirrors positive alpha to negative alpha. Neither processing step creates additional measurements. At Re6M, for example, `(10.12°, 1.0707, .01201)` and `(18.02°, .9967, .18785)` retain the original CL/CD values.

## Domain and interpolation limits

NACA 0012 has anchors at Re200k, 1M and 6M. Alpha and Re use linear interpolation. **Interpolation from the natural-transition XFOIL predictions to the tripped Re6M experiment is an uncalibrated, cross-source engineering bridge.** It does not establish experimentally validated coverage throughout 200k–6M, nor a measured transition model. Source and modelling details live in this document; the workshop contains only the airfoil selector.

The input alpha domains also differ: 200k ends at 14°, 1M at 18.5°, and the positive Re6M branch at 19.08°. A shorter table holds its endpoint beyond its last row. The common 19.08° boundary avoids a discontinuity when crossing the Re1M anchor; from there a smooth blend reaches the existing separated flat-plate proxy at 35°. Endpoint holding and the blend are uncalibrated post-domain modelling. At Re6M, the measured stall drop before 19.08° is retained, not replaced by a fabricated smooth stall curve. Quarter-chord Cm is zero by section symmetry, **not** a measured moment table. The DAE-11 thin-airfoil Cm and its low-Re proxy remain separate.

The engineering model covers **0–30m/s for Birdman aircraft** and **0–100m/s for ordinary aircraft**, including every system aircraft's main wing, auxiliary wing and fin at its actual root/tip chords. At the target maxima, system-aircraft Re reaches 3.37 million for Birdman and 31.64 million for ordinary aircraft (the twin jet has a 4.62m root chord). No source-data range gate rejects these designs. Airspeed and local chord enter Reynolds number as Re=Vc/ν, with ν=1.46×10⁻⁵m²/s. The implementation also remains finite beyond these target speeds, including the existing tunnel settings (Birdman 50m/s, ordinary 200m/s).

- Below Re200k, retain the bounded low-Re lift penalty and profile-drag increase. At zero flow the coefficients remain finite and the dynamic pressure gives zero aerodynamic force.
- Between source anchors, retain the existing interpolation and original numeric rows.
- Above the last source anchor (DAE-11 Re1M, NACA 0012 Re6M), retain the anchor lift/stall/moment curve and multiply profile drag by **0.4 + 0.6 × (Re / Re_anchor)⁻¹/⁵**. This represents a fixed 40% pressure-drag share and a turbulent skin-friction trend for the remaining share. The split is an explicit game-model assumption, not a measured decomposition. It joins continuously at the anchor, decreases gently with Re and cannot drive profile drag below 40% of the anchor. The symmetric fin proxy uses the same high-Re extension from Re1M.
- Finite-wing, sweep, wake, ground-effect, control and separated-flow approximations still apply. Separated flat-plate drag is not reduced by the high-Re correction. No compressibility correction is added for the requested ordinary-aircraft range (100m/s ≈ Mach .29).

These are reasonable engineering extrapolations for gameplay, not newly measured polar data. Source coverage is kept distinct from model coverage here, without invalid-geometry or calibration warnings in the UI. The live aerodynamic panel ends at lift/drag ratio; the speed×lift/drag row and all following Reynolds/source text are removed in both flight and tunnel views. Workshop airfoil settings retain only independent main/auxiliary selectors; Birdman selectors remain fixed to DAE-11.

## Geometry, mass and strength

DAE-11 uses the checked-in upper/lower coordinates with linear interpolation. NACA 0012 uses the standard 12% thickness equation with a closed trailing edge. This is a section geometry model, not a claim to reproduce every detail of a particular tunnel test article. Skin vertices, control hinges and contact points share these ordinates. Main and auxiliary wings select independently; export/import/history/replay retain the IDs. Older designs default to DAE-11 and unknown IDs are rejected.

Airfoil choice does **not** change the selected material's density, Young/shear modulus or strength in pascals. Instead:

1. Sample each unit-chord section at 256 intervals to obtain its maximum thickness, enclosed area and skin perimeter.
2. Relative to the DAE-11 equivalent-beam baseline, scale the beam's normal depth by the section thickness ratio. Keep width fixed; scale wall thickness by `min(1, depthRatio)` so valid thick-wall imports cannot gain a negative inner height. Material amount retains its existing square-root scaling.
3. Recompute tube area, both second moments, torsion constant and section moduli. Spar mass uses the unchanged material density times beam area and actual beam length. Thus stiffness, stress and failure load change geometrically.
4. Scale skin mass by the selected section's perimeter ratio. Recompute section mass, CG and inertia. Enclosed wing volume changes with section area, so mass per enclosed wing volume also changes; this is **wing bulk density**, distinct from material density. These quantities remain covered by physics tests; the selector UI no longer displays them.

This equivalent spar/skin recipe is not a laminate design or a guarantee that a constant-depth spar fits every narrow tip. It intentionally retains the DAE-11 baseline mass recipe.

## T-tail, Birdman and speed

T-tail incidence is editable in the workshop and live tunnel. A shared crown mapping blends the final 0.8m of the fin into the mounted tail's upper section using a smoothstep weight. It includes camber, section thickness, incidence and the tapered dihedral envelope. Degenerate folded envelopes use a bounded end-section bridge to avoid singular intersection coordinates. Roots remain fixed. The curved crown is a geometric joint envelope, not a CFD fillet model. The same mapping drives the skin, fin handles, contacts, aerodynamic stations and beam references. During live changes, attached fin mass/inertia and contact references are updated; existing GPU buffers are reused. Detached sections retain their release incidence/crown and reference geometry. Restoration rebuilds the intact aircraft at the current actual angle.

Fixing Birdman aircraft to DAE-11 while allowing geometry edits is reasonable as a consistent **game rule and exploration mode**. It is not justified by claiming all out-of-domain geometry must perform worse: that is not generally true. Birdman imports and type changes normalize both selectable wings to DAE-11, lock their selectors and allow geometry edits.

The tunnel previously zeroed all three aerodynamic control axes for Birdman aircraft. It now zeroes only elevator/aileron (which continue to move the pilot), while rudder reaches the existing control-axis mixing, response/reversal, physical section deflection and renderer. Birdman wind targets and both UI controls clamp to **50m/s**, including entering from a faster ordinary design and restoration. Ordinary aircraft retain 200m/s.

## Regression coverage

`tests/airfoils.test.ts` checks source anchors, bridge/endpoints, reverse flow, section geometry, mass/stiffness/inertia, material invariance, independent import/export, legacy defaults, Birdman normalization, root/tip coefficients at every integer speed through the requested ranges, signed T-tail angles, live/fresh references and contacts, detached crowns, rudder moments/axes/reversal and API speed limits. `tests/pr56-airfoils.spec.ts` exercises real workshop/tunnel controls and WebGL vertices, including geometry buffer reuse and signed Birdman rudder motion. Existing laboratory, model, structure, replay and performance tests supplement these checks. Final command results are recorded in the PR follow-up comment.

`tests/review56-drag.test.ts` additionally probes real forces and drag-budget closure for every system aircraft at rest and across its target speed range, using both selectable airfoils for ordinary aircraft. `tests/flight-ui.spec.ts` checks T/Y/U ordering and the vertical throttle with real pointer and 1/2-key input, including short-window and narrow test-space layouts. The RPM track fills upward independently of the setpoint thumb.
