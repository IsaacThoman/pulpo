# Material loading shapes

These cubic Bézier morph pairs are generated from AndroidX Material 3
`MaterialShapes` (1.5.0-alpha17) and `androidx.graphics:graphics-shapes` (1.1.0),
the same libraries used by the Android app. They are application vector data,
not captured QA evidence. No bitmap frames or runtime dependency are needed.

Copyright 2024 The Android Open Source Project. Licensed under Apache 2.0;
see [LICENSE](LICENSE). Geometry is normalized and rounded to five decimal places.

Sources:
- [MaterialShapes.kt](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/MaterialShapes.kt)
- [LoadingIndicator.kt](https://github.com/androidx/androidx/blob/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/LoadingIndicator.kt)

`ExportShapes.java` reproduces the geometry. Run with Java 21 and the classes.jar
from Material 3, graphics-shapes, Compose ui-graphics/ui-geometry/ui-unit/ui-util,
plus collection-jvm and kotlin-stdlib on the classpath:

```sh
java -cp "$MATERIAL_SHAPES_CLASSPATH" apps/mobile/assets/loading/ExportShapes.java > apps/mobile/assets/loading/material-morphs.json
```

The sequence is SoftBurst → Cookie9Sided → Pentagon → Pill → Sunny →
Cookie4Sided → Oval → SoftBurst. Each pair stores the matched start and end
curves: the first two coordinates are a move, followed by six per cubic.
The iOS renderer interpolates these curves on the UI thread, using Material's
650 ms morph cadence, spring response, and continuous plus quarter-turn rotation.
