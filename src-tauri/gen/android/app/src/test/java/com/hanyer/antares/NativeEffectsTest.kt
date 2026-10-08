package com.hanyer.antares

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeEffectsTest {
    @Test fun boostsReserveHeadroomWithoutAmplifyingFlatOrCutOnlyCurves() {
        assertEquals(0f, NativeEffects.headroom(floatArrayOf(0f,0f)), 0.001f)
        assertEquals(0f, NativeEffects.headroom(floatArrayOf(-6f,-2f)), 0.001f)
        assertEquals(6f, NativeEffects.headroom(floatArrayOf(6f,-2f,4f)), 0.001f)
    }
}
