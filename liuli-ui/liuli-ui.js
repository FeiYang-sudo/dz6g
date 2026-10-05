(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // shaders/sdf.ts
  var SDF_GLSL = (
    /* glsl */
    `
// 圆角样式：0 = 圆形（标准圆弧），1 = 连续（squircle/超椭圆）
uniform float uCornerStyle;

// 连续曲率 SDF 纹理（胶囊形状）：uUseContinuousSdf=1 时 sdShape 采样预计算纹理，仅对话框卡片使用
uniform sampler2D uContinuousSdf;
uniform float uUseContinuousSdf;        // 0 或 1
uniform vec2  uContinuousSdfTexSize;    // SDF 纹理尺寸，单位 px（256, 256）
uniform vec2  uContinuousSdfElementSize; // 元素的原始 w,h，单位 px

// radiusAt — 按象限选取圆角半径
float radiusAt(vec2 coord, vec4 radii) {
    if (coord.x >= 0.0) {
        if (coord.y <= 0.0) return radii.y;
        else return radii.z;
    } else {
        if (coord.y <= 0.0) return radii.x;
        else return radii.w;
    }
}

// sdRoundedRect — 圆角矩形的带符号距离（内负外正）
float sdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
    float outside = length(max(cornerCoord, 0.0)) - radius;
    float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
    return outside + inside;
}

// sdContinuousRoundedRect — 连续曲率圆角矩形，直接复用 sdRoundedRect（圆弧近似在亚像素级精度内）
float sdContinuousRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    return sdRoundedRect(coord, halfSize, radius);
}

// sampleClipMask — 采样遮罩纹理 R 通道（覆盖度 [0,1]），用于 clip + edgeAlpha
float sampleClipMask(vec2 coord, vec2 halfSize, float radius) {
    float maxDim = max(max(uContinuousSdfElementSize.x, uContinuousSdfElementSize.y), 1e-4);
    float aspectW = uContinuousSdfElementSize.x / maxDim;
    float margin = 4.0;
    float drawW = (uContinuousSdfTexSize.x - 2.0 * margin) * aspectW;
    float scale = drawW / max(uContinuousSdfElementSize.x, 1e-4);
    vec2 tex = uContinuousSdfTexSize * 0.5 + coord * scale;
    vec2 uv = tex / uContinuousSdfTexSize;
    return texture2D(uContinuousSdf, uv).r;  // R = 覆盖度 [0,1]
}

// sampleClipSdf \u2014 从遮罩纹理中采样 G 通道（SDF）。
// 返回带符号距离：内部为负，外部为正，边缘处为 0。
// 与 sampleClipMask 形状相同（均来自同一 Bezier 路径），因此 clip
// 与 stroke 形状始终完全一致。
float sampleClipSdf(vec2 coord, vec2 halfSize, float radius) {
    float maxDim = max(max(uContinuousSdfElementSize.x, uContinuousSdfElementSize.y), 1e-4);
    float aspectW = uContinuousSdfElementSize.x / maxDim;
    float margin = 4.0;
    float drawW = (uContinuousSdfTexSize.x - 2.0 * margin) * aspectW;
    float scale = drawW / max(uContinuousSdfElementSize.x, 1e-4);
    vec2 tex = uContinuousSdfTexSize * 0.5 + coord * scale;
    vec2 uv = tex / uContinuousSdfTexSize;
    float g = texture2D(uContinuousSdf, uv).g;  // G = SDF [0,1]
    return (g * 2.0 - 1.0) * radius;  // 解码为元素空间距离
}

// sdClipShape \u2014 当 uUseContinuousSdf 关闭时，用于 clip/discard 的 SDF。
float sdClipShape(vec2 coord, vec2 halfSize, float radius) {
    return sdRoundedRect(coord, halfSize, radius);
}

// sdShape \u2014 用于折射/高光内部计算的 SDF。
// 当 uUseContinuousSdf=1 时，使用 sampleClipSdf（与 clip 遮罩相同形状）。
// 否则使用 sdRoundedRect。
float sdShape(vec2 coord, vec2 halfSize, float radius) {
    if (uUseContinuousSdf > 0.5) {
        return sampleClipSdf(coord, halfSize, radius);
    }
    return sdRoundedRect(coord, halfSize, radius);
}

// gradSdRoundedRect — SDF 梯度（从边缘指向外侧），用于折射方向与高光镜面反射
vec2 gradSdRoundedRect(vec2 coord, vec2 halfSize, float radius) {
    vec2 cornerCoord = abs(coord) - (halfSize - vec2(radius));
    if (cornerCoord.x >= 0.0 || cornerCoord.y >= 0.0) {
        vec2 v = max(cornerCoord, vec2(0.0));
        // 防止 normalize(0,0) 产生 NaN
        float len = length(v);
        if (len < 1e-6) return vec2(0.0);
        return sign(coord) * (v / len);
    } else {
        float gradX = step(cornerCoord.y, cornerCoord.x);
        return sign(coord) * vec2(gradX, 1.0 - gradX);
    }
}

// rotateBy \u2014 将 2D 向量旋转 angle 弧度。用于将采样坐标反向旋转
// 到元素的本地空间（使 SDF 形状看起来旋转了 +uElementRotation），
// 以及将折射偏移旋转回屏幕空间。
vec2 rotateBy(vec2 v, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}
`
  );
  var COVER_GLSL = (
    /* glsl */
    `
// 返回画布像素坐标（左上角为原点）对应的壁纸 UV。
vec2 coverUv(vec2 canvasPx) {
    float canvasAspect = uCanvasSize.x / uCanvasSize.y;
    float wpAspect = uWallpaperSize.x / uWallpaperSize.y;
    vec2 uv = canvasPx / uCanvasSize;
    if (wpAspect > canvasAspect) {
        // 壁纸比画布更宽 \u2014 水平裁剪。
        float s = canvasAspect / wpAspect;
        uv.x = (uv.x - 0.5) * s + 0.5;
    } else {
        // 壁纸比画布更高 \u2014 垂直裁剪。
        float s = wpAspect / canvasAspect;
        uv.y = (uv.y - 0.5) * s + 0.5;
    }
    return uv;
}

// 每轴缩放：1 个画布像素对应的壁纸 UV 单位，用于将模糊半径从画布 px 转换为 UV 空间偏移
vec2 canvasPxToUvScale() {
    float canvasAspect = uCanvasSize.x / uCanvasSize.y;
    float wpAspect = uWallpaperSize.x / uWallpaperSize.y;
    if (wpAspect > canvasAspect) {
        return vec2(canvasAspect / wpAspect, 1.0) / uCanvasSize;
    } else {
        return vec2(1.0, wpAspect / canvasAspect) / uCanvasSize;
    }
}
`
  );

  // shaders/element-uniforms.ts
  var ELEMENT_UNIFORMS_GLSL = (
    /* glsl */
    `
uniform sampler2D uBackdrop;
uniform sampler2D uWallpaperSampler;  // 壁纸纹理（未缩放的 backdrop，用于切换旋钮）
uniform sampler2D uTabsBackdropSampler;  // tabsBackdrop FBO（着色后的场景，用于指示器 CombinedBackdrop）
uniform vec2  uCanvasSize;        // 画布尺寸，单位 px
uniform vec2  uWallpaperSize;     // 未使用 \u2014 保留以兼容 uniform 设置
uniform vec2  uElementOffset;     // 元素左上角在画布中的位置，单位 px（缩放后的矩形 \u2014 绘制 quad 的位置）
uniform vec2  uElementSize;       // 元素尺寸，单位 px（缩放后 \u2014 包含 graphicsLayer 的 scaleX/scaleY）
uniform vec4  uCornerRadii;       // (topLeft, topRight, bottomRight, bottomLeft)，单位 px（原始，未缩放）
uniform float uRefractionHeight;  // px（原始空间，未按 layerScale 缩放）
uniform float uRefractionAmount;  // px（原始空间，未缩放）
// 图层变换（graphicsLayer { scaleX, scaleY }）：在原始空间计算 SDF/折射，再映射回屏幕空间，保持 SDF 形状不拉伸
uniform vec2  uOriginalSize;        // 元素尺寸，单位 px（原始，未按 graphicsLayer 缩放）
uniform float uOriginalCornerRadius; // 圆角半径，单位 px（原始，未缩放）
uniform vec2  uLayerScale;          // 来自 graphicsLayer 的 (scaleX, scaleY) \u2014 映射原始\u2192屏幕
uniform float uElementRotation;    // 旋转弧度（graphicsLayer rotationZ）\u2014 0 = 无旋转
uniform float uDepthEffect;       // 0 或 1
uniform float uChromaticAberration; // 0 或 1
uniform float uBlurRadius;        // px
uniform float uSaturation;        // vibrancy = 1.5
uniform float uBrightness;        // 亮度偏移（vibrancy 时为 0）
uniform float uContrast;          // vibrancy 时为 1.0
uniform vec4  uTintColor;         // rgba；alpha 为 0 = 无着色
uniform vec4  uSurfaceColor;      // rgba；alpha 为 0 = 无表面
uniform vec4  uHighlightColor;    // rgb + 1.0（alpha 由 uHighlightAlpha 处理）
uniform float uHighlightAngle;    // 弧度
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=默认, 1=环境光, 2=纯色
uniform float uHighlightStrokeWidth; // px（完整描边宽度，与 paint.strokeWidth 一致）
uniform float uHighlightBlur;     // px（BlurMaskFilter 半径）
uniform float uInnerShadowRadius;
uniform float uInnerShadowAlpha;
uniform vec2  uInnerShadowOffset;
// 内容缩放（非均匀）：Toggle X gooseLerp(2/3,0.75) Y gooseLerp(0,0.75)；Slider X gooseLerp(2/3,1) Y gooseLerp(0,1)。静止时 Y=0 backdrop 退化，白色覆盖层遮盖
uniform float uContentScaleX;
uniform float uContentScaleY;
// Toggle 旋钮 CombinedBackdrop：uUseToggleBackdrop=1 时采样外层 backdrop + 合成缩放后的轨道颜色；uUseSolidBackdrop=1 时外层为纯色，否则为壁纸纹理
uniform float uUseToggleBackdrop;
uniform float uUseSolidBackdrop;
uniform vec4  uSolidBackdropColor;  // rgba 0..1；当 uUseSolidBackdrop = 1.0 时使用
uniform vec4  uTrackColor;        // rgba 0..1；alpha 为 0 = 无轨道颜色
uniform vec4  uTrackRect;         // (centerX, centerY, halfW, halfH)，单位画布 px（dpr 缩放后）
uniform float uTrackCornerRadius; // 画布 px（dpr 缩放后）
// 底部 tab \u6307\u793A\u5668 CombinedBackdrop：\u6307\u793A\u5668 backdrop = CombinedBackdrop(wallpaper, \u5185\u5C42\u80CC\u666F\u677F)；隐藏 Row 经 ColorFilter.tint 着色，不透明 \u6807\u7B7E\u5185\u5BB9（图标/标签）变蓝，玻璃部分透明。最多 8 个 tab 矩形
uniform float uIndicatorBackdrop;    // 0 或 1
uniform vec4  uContainerRect;        // (centerX, centerY, halfW, halfH)，单位画布 px（dpr 缩放后）
uniform float uContainerCornerRadius; // 画布 px（dpr 缩放后）
uniform vec4  uIndicatorAccent;      // (r, g, b, a) \u2014 accentColor + 未使用
uniform float uInsetPx;              // 指示器 backdrop 内缩，单位设备 px（4dp * dpr）
uniform float uIndicatorPressProgress; // 0..1 按压进度（用于第二层缩放）
uniform float uIndicatorPanelOffset; // 面板偏移，单位设备 px（第二层 x 平移）
uniform float uDpr;                 // 设备像素比（用于 dp\u2192px 转换）
uniform vec2  uContainerCenter;      // 容器中心（缩放原点），单位画布 px（dpr 缩放后）
uniform float uContainerScale;       // 容器 layerBlock 缩放（1 + 16dp/width * pressProgress）
// Tab 内容 fgTextures（图标+标签 alpha 遮罩）用于蓝色着色。最多 8 个 tab。不透明像素变蓝，玻璃部分透明
uniform sampler2D uTabContentTex0;
uniform sampler2D uTabContentTex1;
uniform sampler2D uTabContentTex2;
uniform sampler2D uTabContentTex3;
uniform sampler2D uTabContentTex4;
uniform sampler2D uTabContentTex5;
uniform sampler2D uTabContentTex6;
uniform sampler2D uTabContentTex7;
uniform vec4  uTabContentRects[8];   // 每个 tab 的 (centerX, centerY, halfW, halfH)，单位画布 px（dpr 缩放后）
uniform float uTabContentCount;      // 有效 tab 矩形数量 (0..8)
uniform sampler2D uTabsGlassLayer;   // tab 内容之前的场景快照（仅壁纸+玻璃，无文字）
// SDF 纹理玻璃
uniform sampler2D uSdfTexSampler;   // clock_sdf 纹理（R=SDF, GB=法线, A=形状 alpha）
uniform float uUseSdfTexture;       // 0 或 1
uniform vec2  uSdfTexSize;          // 纹理自然尺寸 (px)
uniform float uSdfLightAngle;       // 斜面光照角度（度）
uniform float uEnterAlpha;          // 全局元素 alpha (enterProgress, 0..1)
// uSkipColorControls=1 时跳过 applyColorControls（cc 已在 backdrop FBO 上 2-pass 模糊前作为全屏 pass 应用）。由 backdropFbo + useSeparableBlur 元素（对话框卡片）使用
uniform float uSkipColorControls;   // 0 或 1
// 放大镜玻璃
uniform float uUseMagnifier;        // 0 或 1
uniform float uMagnifierZoom;       // 缩放因子 (1.5)
uniform float uMagnifierOffsetY;    // 采样 Y 偏移到光标（80dp，设备 px）
// uSampleWallpaper=1 时 sampleBackdrop 用 coverUv + uWallpaperSampler（干净壁纸）而非场景 FBO，用于遮罩层之上的元素使玻璃折射干净壁纸
uniform float uSampleWallpaper;     // 0 或 1
// 遮罩颜色（在 colorControls/blur/lens 之前应用到壁纸）。uSampleWallpaper=1 时在 shader 中应用遮罩以复现 wallpaper+scrim 合成的 backdrop。a=0 表示无遮罩，SrcOver 应用：backdrop.rgb = scrim.rgb*scrim.a + backdrop.rgb*(1-scrim.a)
uniform vec4 uScrimColor;           // rgba 0..1; a=0 = 无遮罩
`
  );

  // shaders/element-utils.ts
  function generateGaussianDisc(tapCount) {
    const taps = [];
    if (tapCount <= 1) {
      taps.push({ x: 0, y: 0, w: 1 });
      return taps;
    }
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const maxRadius = 3;
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const t = (i + 0.5) / tapCount;
      const r = maxRadius * Math.sqrt(t);
      const angle = i * goldenAngle;
      const x = r * Math.cos(angle);
      const y = r * Math.sin(angle);
      const dist2 = x * x + y * y;
      const w = Math.exp(-0.5 * dist2);
      taps.push({ x, y, w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.w /= totalW;
    }
    return taps;
  }
  function generateBlurGLSL(taps, sampler, uvVar, pxToUvExpr) {
    if (taps.length === 1) {
      return `    return texture2D(${sampler}, ${uvVar});
`;
    }
    let code = "";
    for (const t of taps) {
      const ox = t.x.toFixed(6);
      const oy = t.y.toFixed(6);
      const w = t.w.toFixed(8);
      code += `    sum += texture2D(${sampler}, ${uvVar} + vec2(${ox}, ${oy}) * ${pxToUvExpr}) * ${w};
`;
    }
    return code;
  }
  var DEFAULT_BLUR_TAPS = 16;
  function generateElementUtilsGLSL(tapCount = DEFAULT_BLUR_TAPS) {
    const taps = generateGaussianDisc(tapCount);
    const backdropBlurCode = generateBlurGLSL(taps, "uBackdrop", "uv", "pxToUv");
    const wallpaperBlurCode = generateBlurGLSL(taps, "uWallpaperSampler", "uv", "pxToUv");
    return (
      /* glsl */
      `
// 前置声明 \u2014 GLSL ES 1.00 要求先声明后使用（blendHue 等定义在后面，但被 sampleIndicatorBackdrop 调用）
vec3 rgb2hsv(vec3 c);
vec3 hsv2rgb(vec3 c);
vec3 blendHue(vec3 dst, vec3 src);

float circleMap(float x) {
    return 1.0 - sqrt(1.0 - x * x);
}

// sampleSdfTexture — 在元素本地坐标处采样 clock_sdf 纹理，返回 vec4(intensity, maskAlpha, normalX, normalY)；外部为零
vec4 sampleSdfTexture(vec2 localPx) {
    vec2 uv = vec2(localPx.x / uOriginalSize.x,
                   localPx.y / uOriginalSize.y);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
        return vec4(0.0);
    }
    vec4 v = texture2D(uSdfTexSampler, uv);
    float sd = v.r * 2.0 - 1.0;
    float mask = smoothstep(0.5, 1.0, v.a);
    if (mask <= 0.0) return vec4(0.0);
    if (mask < 1.0) sd = 0.0;
    vec2 normal = normalize(v.gb * 2.0 - 1.0);
    float intensity = circleMap(1.0 - min(1.0, -sd * 1.5));
    return vec4(intensity, mask, normal.x, normal.y);
}

// sceneUv — 画布像素坐标（左上角为原点）转场景纹理 UV（场景纹理用 gl_FragCoord 左下角原点渲染，故 Y 翻转）
vec2 sceneUv(vec2 canvasPx) {
    return vec2(canvasPx.x / uCanvasSize.x, 1.0 - canvasPx.y / uCanvasSize.y);
}

// sampleBackdrop — 高斯圆盘模糊（${tapCount} 个 tap，JS 动态生成；radius<0.5 时单 tap 无模糊）。
// uSampleWallpaper>0.5 时采样干净壁纸并应用遮罩以复现 wallpaper+scrim 合成 backdrop（每个采样点都获得相同合成，修复"边缘未应用遮罩"的 bug）
vec4 sampleBackdrop(vec2 canvasPx, float radius) {
    if (uSampleWallpaper > 0.5) {
        vec2 uv = coverUv(canvasPx);
        vec4 c;
        if (radius < 0.5) {
            c = texture2D(uWallpaperSampler, uv);
        } else {
            vec2 pxToUv = radius * canvasPxToUvScale();
            vec4 sum = vec4(0.0);
${wallpaperBlurCode}            c = sum;
        }
        // 应用遮罩 (SrcOver)，使 backdrop = wallpaper+scrim，不透明。
        if (uScrimColor.a > 0.001) {
            c.rgb = uScrimColor.rgb * uScrimColor.a + c.rgb * (1.0 - uScrimColor.a);
            c.a = 1.0;
        }
        return c;
    }
    vec2 uv = sceneUv(canvasPx);
    if (radius < 0.5) {
        return texture2D(uBackdrop, uv);
    }
    vec2 pxToUv = radius / uCanvasSize;
    vec4 sum = vec4(0.0);
${backdropBlurCode}    return sum;
}

// sampleWallpaperBlurred — 壁纸高斯圆盘模糊，由 SDF 纹理玻璃路径（锁屏）使用
vec4 sampleWallpaperBlurred(vec2 canvasPx, float radius) {
    vec2 uv = coverUv(canvasPx);
    if (radius < 0.5) {
        return texture2D(uWallpaperSampler, uv);
    }
    vec2 pxToUv = radius * canvasPxToUvScale();
    vec4 sum = vec4(0.0);
${wallpaperBlurCode}    return sum;
}

// sampleToggleBackdrop — Toggle 旋钮 CombinedBackdrop 采样。外层 backdrop（t1=壁纸/t2=纯色）+ 合成缩放后的轨道颜色矩形（uTrackRect 位置 + 圆角 SDF + smoothstep 边缘 AA）。uTrackColor.a=0 或轨道退化（halfW/halfH<0.5px，静止时 scaleY=0）时跳过合成
vec4 sampleToggleBackdrop(vec2 canvasPx, float radius) {
    // 1. 采样带模糊的外层 backdrop。
    vec4 wp;
    if (uUseSolidBackdrop > 0.5) {
        // CanvasBackdrop 场景 (t2)：纯色填充整个旋钮区域
        wp = uSolidBackdropColor;
    } else if (radius < 0.5) {
        // LayerBackdrop 场景 (t1)：必须用 coverUv（cover-fit）匹配壁纸背景 pass；用 sceneUv 会在宽高比不同时采样错误 texel
        vec2 uv = coverUv(canvasPx);
        wp = texture2D(uWallpaperSampler, uv);
    } else {
        // LayerBackdrop 场景 (t1) 带模糊：壁纸上 9-tap poisson 圆盘。pxToUv 经 canvasPxToUvScale() 考虑 cover-fit 宽高比裁剪
        vec2 uv = coverUv(canvasPx);
        vec2 pxToUv = radius * canvasPxToUvScale();
        vec4 sum = vec4(0.0);
        float total = 0.0;
        sum += texture2D(uWallpaperSampler, uv) * 0.25; total += 0.25;
        sum += texture2D(uWallpaperSampler, uv + vec2( 1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2(-1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000,  1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000, -1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        wp = sum / total;
    }

    // 2. 在上方合成缩放后的轨道颜色（uTrackRect 中心+半尺寸+uTrackCornerRadius 圆角 SDF，smoothstep 边缘 AA+模糊）
    if (uTrackColor.a > 0.001 && uTrackRect.z > 0.5 && uTrackRect.w > 0.5) {
        vec2 trackCenter = uTrackRect.xy;
        vec2 trackHalf = uTrackRect.zw;
        vec2 trackLocal = canvasPx - trackCenter;
        float tr = uTrackCornerRadius;
        // 圆角矩形 SDF（与 SDF_GLSL 中 sdRoundedRect 一致）
        vec2 q = abs(trackLocal) - trackHalf + vec2(tr);
        float trackSd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - tr;
        // 按 uBlurRadius 模糊边缘：内部 (trackSd < -radius) \u2192 mask=1；外部 (trackSd > radius) \u2192 mask=0
        float mask = 1.0 - smoothstep(-radius, radius, trackSd);
        // srcOver 合成（轨道颜色覆盖外层 backdrop）
        float a = mask * uTrackColor.a;
        wp.rgb = mix(wp.rgb, uTrackColor.rgb, a);
        wp.a = mix(wp.a, 1.0, a);
    }
    return wp;
}

// sampleIndicatorBackdrop — LiquidBottomTabs.kt 指示器 CombinedBackdrop。
// 命名：\u5BB9\u5668 (Container)=外部玻璃条 64dp；\u6307\u793A\u5668 (Indicator)=选中胶囊 56dp；\u5185\u5C42\u80CC\u666F\u677F (Inner backdrop)=隐藏 Row 56dp 玻璃，tint 着色由指示器采样；\u6807\u7B7E\u5185\u5BB9 (Tab content)=图标+标签。
// 实现：1. 采样壁纸外层 backdrop 带模糊；2. 在 INSET 胶囊 SDF（containerRect 各边缩小 4dp）内合成场景 FBO（容器玻璃+内容），作为指示器内部"较小背景板"
vec4 sampleIndicatorBackdrop(vec2 canvasPx, float radius) {
    // 1. 经由 coverUv (cover-fit) 采样壁纸（外层 LayerBackdrop）。
    vec4 wp;
    if (radius < 0.5) {
        vec2 uv = coverUv(canvasPx);
        wp = texture2D(uWallpaperSampler, uv);
    } else {
        vec2 uv = coverUv(canvasPx);
        vec2 pxToUv = radius * canvasPxToUvScale();
        vec4 sum = vec4(0.0);
        float total = 0.0;
        sum += texture2D(uWallpaperSampler, uv) * 0.25; total += 0.25;
        sum += texture2D(uWallpaperSampler, uv + vec2( 1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2(-1.000,  0.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000,  1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.000, -1.000) * pxToUv) * 0.12; total += 0.12;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2( 0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707,  0.707) * pxToUv) * 0.0675; total += 0.0675;
        sum += texture2D(uWallpaperSampler, uv + vec2(-0.707, -0.707) * pxToUv) * 0.0675; total += 0.0675;
        wp = sum / total;
    }

    // 2. \u5185\u5C42\u80CC\u666F\u677F (Inner backdrop) SDF \u2014 隐藏 Row 的 56dp 玻璃胶囊。隐藏 Row 无 layerBlock，玻璃不随容器缩放，仅 panelOffset 平移
    vec2 capsuleHalf = max(uContainerRect.zw, vec2(0.0));
    float cr = max(uContainerCornerRadius, 0.0);
    // 中心 = rectCenter + panelOffset（无容器缩放）
    vec2 scaledCenter = uContainerRect.xy + vec2(uIndicatorPanelOffset, 0.0);
    vec2 capsuleLocal = canvasPx - scaledCenter;
    vec2 cq = abs(capsuleLocal) - capsuleHalf + vec2(cr);
    float capsuleSd = length(max(cq, vec2(0.0))) + min(max(cq.x, cq.y), 0.0) - cr;
    float mask = 1.0 - smoothstep(-radius, radius, capsuleSd);

    // 3. 采样玻璃层 FBO（壁纸+容器玻璃，无 tab 文字）。容器玻璃渲染后但 tab 内容绘制前的快照，蓝色 tab 文字通过 fgTexture 绘制在上方（步骤 4）
    vec2 sceneUv2 = sceneUv(canvasPx - vec2(uIndicatorPanelOffset, 0.0));
    vec4 scene = texture2D(uTabsGlassLayer, sceneUv2);

    // 4. 在玻璃层上方绘制蓝色 \u6807\u7B7E\u5185\u5BB9 (tab 内容：图标/标签)。fgTexture alpha 作硬遮罩，图标/标签像素变蓝，其他保持玻璃层自然色，无白色边缘。隐藏 Row tab 内容按 gooseLerp(1, 1.2, pressProgress) 缩放 + panelOffset 平移（不随容器缩放）
    float contentScale = 1.0 + 0.2 * uIndicatorPressProgress;
    float tabMask = 0.0;
    for (int i = 0; i < 8; i++) {
        if (float(i) >= uTabContentCount) break;
        vec4 r = uTabContentRects[i];
        if (r.z > 0.5 && r.w > 0.5) {
            // Tab 内容围绕其自身中心按 contentScale 缩放，按 panelOffset 平移
            vec2 tabCenter = r.xy + vec2(uIndicatorPanelOffset, 0.0);
            vec2 scaledHalf = r.zw * contentScale;
            vec2 localPx = canvasPx - (tabCenter - scaledHalf);
            vec2 uv = localPx / (scaledHalf * 2.0);
            if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
                float a = 0.0;
                if (i == 0) a = texture2D(uTabContentTex0, uv).a;
                else if (i == 1) a = texture2D(uTabContentTex1, uv).a;
                else if (i == 2) a = texture2D(uTabContentTex2, uv).a;
                else if (i == 3) a = texture2D(uTabContentTex3, uv).a;
                else if (i == 4) a = texture2D(uTabContentTex4, uv).a;
                else if (i == 5) a = texture2D(uTabContentTex5, uv).a;
                else if (i == 6) a = texture2D(uTabContentTex6, uv).a;
                else if (i == 7) a = texture2D(uTabContentTex7, uv).a;
                tabMask = max(tabMask, a);
            }
        }
    }
    // 直接用 fgTexture alpha 作蓝色合成因子。fgTexture LINEAR 过滤，alpha 有平滑 AA 边缘，无需 smoothstep 阈值（之前用阈值会因硬裁剪 AA 梯度产生锯齿）
    vec3 sceneColor = mix(scene.rgb, uIndicatorAccent.rgb, tabMask);

    // 5. 在 inset 胶囊内将场景合成到壁纸上方 (SrcOver)。
    float a = scene.a * mask;
    vec3 resultRgb = mix(wp.rgb, sceneColor, a);

    // 6. \u5185\u5C42\u80CC\u666F\u677F 边缘高光 \u2014 DefaultHighlightShaderString AGSL：gradSdRoundedRect \u00B7 normal，intensity=pow(|d|, falloff)，angle=45\xB0 falloff=1 gradRadius=min(radius*1.5, min(halfW, halfH))。描边外侧半部分被裁剪，留下内侧半部分。贡献 = White(1.0) * intensity * strokeMask * progress，Plus 混合。与 \u6307\u793A\u5668 自身边缘高光（后处理 pass 步骤 2f）shader 数学相同，区别仅 SDF：此处 \u5185\u5C42\u80CC\u666F\u677F 胶囊，那里 \u6307\u793A\u5668 自身胶囊
    float highlightAlpha = uIndicatorPressProgress;
    if (highlightAlpha > 0.001) {
        // SDF 梯度 + Default 高光强度 (angle=45\xB0, falloff=1)
        float indRadius = max(cr, 0.0);
        float indHalfMin = min(capsuleHalf.x, capsuleHalf.y);
        float gradRadius = min(indRadius * 1.5, indHalfMin);
        vec2 grad = gradSdRoundedRect(capsuleLocal, capsuleHalf, gradRadius);
        vec2 normal = vec2(0.70710678, 0.70710678); // cos(45\xB0), sin(45\xB0)
        float d = dot(grad, normal);
        float intensity = pow(abs(d), 1.0);

        // 描边遮罩 \u2014 HighlightModifier.kt + BlurMaskFilter：style=Stroke, strokeWidth=ceil(0.5dp*dpr)*2, blur sigma=0.25*dpr, clipOutline 裁剪到内部 (capsuleSd<=0)。Skia/Android 中 BlurMaskFilter radius 参数即高斯 sigma。capsuleSd 单位设备 px，sigma 与 strokeHalf 也用设备 px。实现：硬边缘描边与高斯核卷积（与 highlight.ts 方法相同），固定 1px tap 间距，tap 数随 sigma 缩放 (2*ceil(3\u03C3)+1, 最大 64)
        float strokeHalf = ceil(0.5 * uDpr) * 2.0 * 0.5;  // = ceil(0.5*dpr)
        float sigma2 = max(0.25 * uDpr, 0.1);  // blurRadius = 0.25dp, sigma = blurRadius*dpr
        float tapSpacing2 = 1.0; // 固定 1px \u2014 tap 数量随 sigma 缩放
        float threeSigma2 = sigma2 * 3.0;
        float strokeMask = 0.0;
        float wSum2 = 0.0;
        for (int j = -32; j <= 32; j++) {
            float offset = float(j) * tapSpacing2;
            if (abs(offset) <= threeSigma2) {
                float sampleSd = capsuleSd - offset;
                float hard = (abs(sampleSd) < strokeHalf) ? 1.0 : 0.0;
                float w = exp(-0.5 * (offset * offset) / (sigma2 * sigma2));
                strokeMask += hard * w;
                wSum2 += w;
            }
        }
        strokeMask /= wSum2;
        strokeMask *= 0.5;  // 裁剪将边缘处的对称描边减半
        // 裁剪到内部（在 \u5185\u5C42\u80CC\u666F\u677F 外部 \u2192 无高光）
        strokeMask = (capsuleSd > 0.0) ? 0.0 : strokeMask;

        // White(1.0) * intensity * strokeMask * progress, Plus 混合（AGSL shader 用 color.copy(alpha=1f)，图层 alpha=progress）
        resultRgb += vec3(1.0) * intensity * strokeMask * highlightAlpha;
    }

    return vec4(resultRgb, 1.0);
}

// sampleMagnifier — 放大镜 backdrop 采样：围绕放大镜中心缩放 uMagnifierZoom，向光标方向偏移 Y
vec4 sampleMagnifier(vec2 canvasPx, float radius) {
    vec2 magCenter = uElementOffset + uElementSize * 0.5;
    vec2 zoomedCoord = magCenter + (canvasPx - magCenter) / uMagnifierZoom;
    vec2 cursorCoord = vec2(zoomedCoord.x, zoomedCoord.y + uMagnifierOffsetY);
    return sampleBackdrop(cursorCoord, radius);
}

// applyColorControls — ColorFilter.kt colorControlsColorFilter 移植。saturation 1.5, brightness 0, contrast 1 -> 纯饱和度提升
vec3 applyColorControls(vec3 c, float brightness, float contrast, float saturation) {
    float invSat = 1.0 - saturation;
    float r = 0.213 * invSat;
    float g = 0.715 * invSat;
    float b = 0.072 * invSat;
    float t = (0.5 - contrast * 0.5 + brightness) * 255.0;
    float cs = contrast * saturation;
    float cr = contrast * r;
    float cg = contrast * g;
    float cb = contrast * b;
    vec3 outc;
    outc.r = (cr + cs) * c.r + cg * c.g + cb * c.b + t / 255.0;
    outc.g = cr * c.r + (cg + cs) * c.g + cb * c.b + t / 255.0;
    outc.b = cr * c.r + cg * c.g + (cb + cs) * c.b + t / 255.0;
    return outc;
}

// HSV 转换 + BlendMode.Hue（Skia 不可分离混合移植）。Hue 混合：从 src 取色相，从 dst 取饱和度+明度。用于 onDrawSurface 中的 drawRect(tint, BlendMode.Hue)
vec3 rgb2hsv(vec3 c) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float delta = maxC - minC;
    float v = maxC;
    float s = maxC < 1e-6 ? 0.0 : delta / maxC;
    float h = 0.0;
    if (delta > 1e-6) {
        if (maxC == c.r) {
            h = mod((c.g - c.b) / delta, 6.0);
        } else if (maxC == c.g) {
            h = (c.b - c.r) / delta + 2.0;
        } else {
            h = (c.r - c.g) / delta + 4.0;
        }
        h *= 60.0;
        if (h < 0.0) h += 360.0;
    }
    return vec3(h / 360.0, s, v);
}

vec3 hsv2rgb(vec3 c) {
    float h = c.x * 6.0;
    float s = c.y;
    float v = c.z;
    float i = floor(h);
    float f = h - i;
    float p = v * (1.0 - s);
    float q = v * (1.0 - s * f);
    float t = v * (1.0 - s * (1.0 - f));
    i = mod(i, 6.0);
    if (i < 1.0) return vec3(v, t, p);
    if (i < 2.0) return vec3(q, v, p);
    if (i < 3.0) return vec3(p, v, t);
    if (i < 4.0) return vec3(p, q, v);
    if (i < 5.0) return vec3(t, p, v);
    return vec3(v, p, q);
}

// blendHue — BlendMode.Hue：从 src 取色相，从 dst 取饱和度+明度
vec3 blendHue(vec3 dst, vec3 src) {
    vec3 dh = rgb2hsv(dst);
    vec3 sh = rgb2hsv(src);
    return hsv2rgb(vec3(sh.x, dh.y, dh.z));
}
`
    );
  }

  // shaders/element.ts
  function generateElementFragmentShader(tapCount = DEFAULT_BLUR_TAPS) {
    const utilsGlsl = generateElementUtilsGLSL(tapCount);
    return (
      /* glsl */
      `
precision highp float;

${ELEMENT_UNIFORMS_GLSL}

${SDF_GLSL}

${COVER_GLSL}

${utilsGlsl}

void main() {
    // gl_FragCoord 原点在 WebGL 中为左下角；翻转为左上角。
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // 内容缩放（非均匀）：< 1.0 时将 backdrop UV 向元素中心压缩（toggle/slider 旋钮按压效果）。静止时 Y=0 退化，白色覆盖层遮盖
    vec2 contentScale = vec2(uContentScaleX, uContentScaleY);
    vec2 sampleCoord = screenCoord;
    if (uContentScaleX < 0.999 || uContentScaleY < 0.999) {
        vec2 elementCenter = uElementOffset + uElementSize * 0.5;
        sampleCoord = elementCenter + (screenCoord - elementCenter) * contentScale;
    }

    // 原始空间 SDF（graphicsLayer { scaleX, scaleY }）：单 pass 复现"在原始空间着色 + graphicsLayer 缩放"。屏幕中心坐标 / uLayerScale 映射回原始空间，SDF/折射在原始空间计算（形状不拉伸），折射偏移再 * layerScale 映射回屏幕空间用于 backdrop 采样。elementCenter 对缩放和原始矩形相同（缩放围绕中心）
    vec2 elementCenter = uElementOffset + uElementSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    // 映射到原始空间（防止除以零）
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    // 应用元素旋转 (graphicsLayer rotationZ)：反向旋转采样坐标到本地空间着色，本地空间折射偏移按 +rotation 旋转回屏幕空间用于 backdrop 采样
    float rot = uElementRotation;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -rot);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // SDF 纹理玻璃路径
    if (uUseSdfTexture > 0.5) {
        vec2 localPx = centeredOrigRot + uOriginalSize * 0.5;
        vec4 sdfData = sampleSdfTexture(localPx);
        if (sdfData.y <= 0.0) discard;
        float intensity = sdfData.x;
        float sdfMask = sdfData.y;
        vec2 normal = sdfData.zw;

        // 直接采样壁纸（而非场景 FBO）\u2014 LockScreenContent.kt drawPlainBackdrop 用 LayerBackdrop（原始壁纸，暗色遮罩之前）。原始实现在 SDF shader 之前应用 blur(2dp)，content 已经模糊。此处用 sampleWallpaperBlurred 复现
        vec2 refractedOffsetOrig = intensity * uRefractionHeight * normal;
        vec2 refractedOffsetScreen = refractedOffsetOrig * layerScale;
        vec2 refractedScreen = screenCoord - refractedOffsetScreen;

        // SdfShader.kt: color = content.eval(refractedCoord) * v.a。原始 onDrawBackdrop 把壁纸和 drawRect(White 0.25) 绘制到同一缓冲区，再应用 RenderEffect 链（colorControls, blur, SDF shader）。复现：先将白色混入原始壁纸，再应用 colorControls（这样 colorControls 也会使白色变暗，contrast=0.75, brightness=-0.1）
        vec4 content = sampleWallpaperBlurred(refractedScreen, uBlurRadius);
        vec3 rawContent = content.rgb;
        // 先在原始壁纸上混入白色覆盖层 (White 0.25 SrcOver)
        if (uSurfaceColor.a > 0.001) {
            rawContent = uSurfaceColor.rgb * uSurfaceColor.a + rawContent * (1.0 - uSurfaceColor.a);
        }
        // 对合并后的缓冲区应用 colorControls
        vec3 contentColor = applyColorControls(rawContent, uBrightness, uContrast, uSaturation);
        // 乘以 sdfMask (v.a) \u2014 忠实于 content * v.a
        vec3 color = contentColor * sdfMask;

        // 斜面光照
        float angleRad = uSdfLightAngle * 3.1415926 / 180.0;
        vec2 lightDir = vec2(cos(angleRad), sin(angleRad));
        float bevel1 = clamp(dot(normal, lightDir), 0.0, 1.0);
        color.rgb *= 1.0 + 0.5 * intensity * bevel1;
        float bevel2 = clamp(dot(normal, -lightDir), 0.0, 1.0);
        color.rgb *= 1.0 + 0.5 * bevel2 * min(1.0, smoothstep(1.0, 0.0, abs(intensity - 0.25) * 6.0));

        gl_FragColor = vec4(color, sdfMask * uEnterAlpha);
        return;
    }

    // 用于折射/高光的 SDF \u2014 始终使用解析 sdRoundedRect
    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);
    // Clip + edgeAA：启用胶囊时用 alpha 遮罩（浏览器原生 AA）
    float edgeAlpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
        if (mask < 0.01) discard;
        edgeAlpha = mask;
    } else {
        if (sd > 0.5) discard;
        edgeAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);
    }

    // 1. Backdrop 采样（折射前）：用 sampleCoord（内容缩放后），使 backdrop 在 uContentScaleX/Y < 1.0 时向内收缩
    vec4 backdrop;
    if (uIndicatorBackdrop > 0.5) {
        backdrop = sampleIndicatorBackdrop(screenCoord, uBlurRadius);
    } else if (uUseToggleBackdrop > 0.5) {
        backdrop = sampleToggleBackdrop(screenCoord, uBlurRadius);
    } else if (uUseMagnifier > 0.5) {
        backdrop = sampleMagnifier(screenCoord, uBlurRadius);
    } else {
        backdrop = sampleBackdrop(sampleCoord, uBlurRadius);
    }
    // colorControls：backdropFbo+useSeparableBlur 元素 cc 已作为全屏 pass 在 2-pass 模糊前应用 (uSkipColorControls=1)，此处跳过避免重复；内联模糊元素此处应用
    vec3 color = (uSkipColorControls > 0.5) ? backdrop.rgb : applyColorControls(backdrop.rgb, uBrightness, uContrast, uSaturation);
    // 放大镜玻璃始终不透明 \u2014 移植版场景纹理可能带部分 alpha（如卡片 0.9），强制 alpha=1
    float alpha = (uUseMagnifier > 0.5) ? 1.0 : backdrop.a;

    // 2. 透镜折射（SDF + circleMap）\u2014 RoundedRectRefractionWithDispersionShaderString 移植。SDF/梯度在原始空间计算；uRefractionHeight/Amount 单位原始 px（未按 layerScale 缩放）。提前退出：距边缘超过 refractionHeight 时完全跳过折射
    if (uRefractionHeight > 0.5 && (-sd) < uRefractionHeight) {
        float sdClamped = min(sd, 0.0);
        float d = circleMap(1.0 - (-sdClamped) / uRefractionHeight) * uRefractionAmount;

        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        // AGSL: normalize(grad + depthEffect * normalize(centeredCoord))
        vec2 depthVec = vec2(0.0);
        if (uDepthEffect > 0.5) {
            float dirLen = length(centeredOrigRot);
            if (dirLen > 1e-6) depthVec = centeredOrigRot / dirLen;
        }
        vec2 gradSum = grad + uDepthEffect * depthVec;
        float gradLen = length(gradSum);
        if (gradLen > 1e-6) grad = gradSum / gradLen;

        // 折射偏移在原始空间计算，再 * layerScale 映射屏幕空间（offset_screen = offset_orig * layerScale）
        vec2 refractedOffsetOrig = d * grad;
        // 本地空间偏移按 +rotation 旋转回屏幕空间再 * layerScale。不旋转时元素旋转折射会指向错误方向
        vec2 refractedOffsetScreen = rotateBy(refractedOffsetOrig, rot) * layerScale;
        vec2 refractedScreen = screenCoord + refractedOffsetScreen;
        vec2 refractedSampleCoord = refractedScreen;
        if (uIndicatorBackdrop < 0.5 && uUseToggleBackdrop < 0.5 &&
            (uContentScaleX < 0.999 || uContentScaleY < 0.999)) {
            refractedSampleCoord = elementCenter + (refractedScreen - elementCenter) * contentScale;
        }

        if (uChromaticAberration > 0.5) {
            // 7 路径色散 (ROYGBV + 紫色)。AGSL: dispersionIntensity = chromaticAberration * (cx*cy)/(hx*hy)，dispersedCoord = d * grad * dispersionIntensity。7 个采样点 dispersedCoord * {1, 2/3, 1/3, 0, -1/3, -2/3, -1} 带加权通道累加
            float dispersionIntensity = 1.0 * ((centeredOrigRot.x * centeredOrigRot.y) / (origHalfSize.x * origHalfSize.y));
            vec2 dispersedOffsetOrig = refractedOffsetOrig * dispersionIntensity;
            vec2 dispersedOffsetScreen = rotateBy(dispersedOffsetOrig, rot) * layerScale;

            // 采样辅助 \u2014 选取正确的 backdrop 采样器
            #define SAMPLE_DISPERSED(offset)                 (uIndicatorBackdrop > 0.5 ? sampleIndicatorBackdrop(refractedScreen + (offset), uBlurRadius) :                  uUseToggleBackdrop > 0.5 ? sampleToggleBackdrop(refractedScreen + (offset), uBlurRadius) :                  uUseMagnifier > 0.5 ? sampleMagnifier(refractedScreen + (offset), uBlurRadius) :                  sampleBackdrop(refractedSampleCoord + (offset), uBlurRadius))

            vec4 sRed    = SAMPLE_DISPERSED(+dispersedOffsetScreen);
            vec4 sOrange = SAMPLE_DISPERSED(+dispersedOffsetScreen * (2.0 / 3.0));
            vec4 sYellow = SAMPLE_DISPERSED(+dispersedOffsetScreen * (1.0 / 3.0));
            vec4 sGreen  = SAMPLE_DISPERSED(vec2(0.0));
            vec4 sCyan   = SAMPLE_DISPERSED(-dispersedOffsetScreen * (1.0 / 3.0));
            vec4 sBlue   = SAMPLE_DISPERSED(-dispersedOffsetScreen * (2.0 / 3.0));
            vec4 sPurple = SAMPLE_DISPERSED(-dispersedOffsetScreen);

            #undef SAMPLE_DISPERSED

            // AGSL shader 通道加权
            vec3 dispColor = vec3(0.0);
            float dispAlpha = 0.0;
            // 红色
            dispColor.r += sRed.r / 3.5;
            dispAlpha  += sRed.a / 7.0;
            // 橙色
            dispColor.r += sOrange.r / 3.5;
            dispColor.g += sOrange.g / 7.0;
            dispAlpha  += sOrange.a / 7.0;
            // 黄色
            dispColor.r += sYellow.r / 3.5;
            dispColor.g += sYellow.g / 3.5;
            dispAlpha  += sYellow.a / 7.0;
            // 绿色
            dispColor.g += sGreen.g / 3.5;
            dispAlpha  += sGreen.a / 7.0;
            // 青色
            dispColor.g += sCyan.g / 3.5;
            dispColor.b += sCyan.b / 3.0;
            dispAlpha  += sCyan.a / 7.0;
            // 蓝色
            dispColor.b += sBlue.b / 3.0;
            dispAlpha  += sBlue.a / 7.0;
            // 紫色
            dispColor.r += sPurple.r / 7.0;
            dispColor.b += sPurple.b / 3.0;
            dispAlpha  += sPurple.a / 7.0;

            color = (uSkipColorControls > 0.5) ? dispColor : applyColorControls(dispColor, uBrightness, uContrast, uSaturation);
            // 放大镜色差强制不透明
            alpha = (uUseMagnifier > 0.5) ? 1.0 : dispAlpha;
        } else {
            vec4 refracted;
            if (uIndicatorBackdrop > 0.5) {
                refracted = sampleIndicatorBackdrop(refractedScreen, uBlurRadius);
            } else if (uUseToggleBackdrop > 0.5) {
                refracted = sampleToggleBackdrop(refractedScreen, uBlurRadius);
            } else if (uUseMagnifier > 0.5) {
                refracted = sampleMagnifier(refractedScreen, uBlurRadius);
            } else {
                refracted = sampleBackdrop(refractedSampleCoord, uBlurRadius);
            }
            color = (uSkipColorControls > 0.5) ? refracted.rgb : applyColorControls(refracted.rgb, uBrightness, uContrast, uSaturation);
            // 放大镜折射强制不透明（见上方 backdrop 采样）
            alpha = (uUseMagnifier > 0.5) ? 1.0 : refracted.a;
        }
    }

    // 3. onDrawSurface: 着色 (BlendMode.Hue + 0.75 alpha)。LiquidButton.kt: drawRect(tint, BlendMode.Hue) 然后 drawRect(tint.copy(alpha=0.75))。第一 pass 用 tint 色相替换 backdrop 色相（Hue 混合, alpha=tint.a），第二 pass 以 0.75*alpha SrcOver 覆盖 tint 颜色
    if (uTintColor.a > 0.001) {
        vec3 hueBlended = blendHue(color, uTintColor.rgb);
        color = mix(color, hueBlended, uTintColor.a);
        color = mix(color, uTintColor.rgb, 0.75 * uTintColor.a);
    }

    // 4. onDrawSurface: surfaceColor (drawRect(surfaceColor))
    if (uSurfaceColor.a > 0.001) {
        color = mix(color, uSurfaceColor.rgb, uSurfaceColor.a);
    }

    // 5. 高光（边缘镜面反射）：边缘高光作为单独 pass 绘制（见 RIM_HIGHLIGHT_FRAGMENT_SHADER），用真正 Plus/SrcOver 混合（HighlightModifier.kt 记录单独图形层）。此处内联执行会通过元素边缘 AA 使高光变暗，错误 \u2014 高光层以其自身混合模式合成在上方

    // 6. 内阴影 \u2014 InnerShadowModifier.kt: 1.用阴影色 (Black 0.15) 绘制轮廓 2.按偏移 (0, radius) 平移（阴影向下） 3.在偏移位置 Clear 轮廓（打孔留环，顶部边缘） 4.按 radius 模糊整个图层 5.以 shadow.alpha SrcOver 合成。结果：顶部内边缘暗化带。此处用反向 SDF 近似：阴影出现在像素位于形状内部但偏移形状外部的位置（环）。偏移将内部形状向下移动（正 Y），环在顶部更厚
    if (uInnerShadowAlpha > 0.001 && uInnerShadowRadius > 0.5) {
        // 偏移形状：相同矩形按阴影偏移平移。SDF 方法：在形状内部 (sd < 0) 且偏移形状外部 (offsetSd > 0)
        vec2 offsetCentered = centeredOrigRot - uInnerShadowOffset;
        float offsetSd = sdShape(offsetCentered, origHalfSize, origRadius);
        // 环 = 在原始形状内部 (sd < 0) 且在偏移形状外部 (offsetSd > 0) 加上基于进入环距离的模糊衰减
        float ring = smoothstep(0.0, uInnerShadowRadius, offsetSd) *
                     (1.0 - smoothstep(-uInnerShadowRadius, 0.0, sd));
        // ring 在环中间为 1，在两边缘衰减
        color *= 1.0 - ring * uInnerShadowAlpha;
    }

    // 7. 边缘抗锯齿：edgeAlpha 已在前面计算（遮罩模式：直接覆盖度，解析模式：smoothstep）
    gl_FragColor = vec4(color, alpha * edgeAlpha * uEnterAlpha);
}
`
    );
  }
  var ELEMENT_FRAGMENT_SHADER = generateElementFragmentShader(DEFAULT_BLUR_TAPS);

  // shaders/shadow.ts
  var SHADOW_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uElementOffset;   // 缩放后的矩形左上角（绘制 quad 的位置）
uniform vec2  uElementSize;     // 缩放后的尺寸（包含 graphicsLayer 缩放）
uniform vec4  uCornerRadii;     // 缩放后的圆角半径
uniform float uShadowRadius;    // 原始 px（未缩放 \u2014 原始尺寸下的 BlurMaskFilter）
uniform vec2  uShadowOffset;    // 原始 px (offsetX, offsetY; +Y = 向下)
uniform vec4  uShadowColor;     // rgba
// 原始空间 SDF（graphicsLayer { scaleX, scaleY }）：与 element shader 相同。原始空间计算阴影 SDF（形状不拉伸），graphicsLayer 缩放整个阴影图层。阴影偏移单位原始 px，乘 uLayerScale 映射屏幕空间 (offset_screen = offset_orig * layerScale)。阴影半径（模糊 sigma）保持原始 px，高斯衰减在原始空间计算（BlurMaskFilter 在原始分辨率模糊，graphicsLayer 缩放模糊后像素）
uniform vec2  uOriginalSize;        // 元素尺寸，单位 px（原始，未缩放）
uniform float uOriginalCornerRadius; // 圆角半径，单位 px（原始，未缩放）
uniform vec2  uLayerScale;          // 来自 graphicsLayer 的 (scaleX, scaleY)
uniform float uElementRotation;     // 旋转弧度（graphicsLayer rotationZ）

${SDF_GLSL}

void main() {
    // 翻转 gl_FragCoord（左下角原点）为左上角原点，使 +Y 向下（与 CSS 约定一致）
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // elementCenter 对缩放和原始矩形相同（缩放围绕中心）
    vec2 elementCenter = uElementOffset + uElementSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    // 映射到原始空间（防止除以零）
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    // 反向旋转到本地空间，使阴影形状随元素旋转。阴影偏移也旋转到本地空间保持一致
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);
    vec2 shadowOffsetRot = rotateBy(uShadowOffset, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // 阴影偏移：原始 px 定义，在屏幕空间应用。原始实现以原始尺寸+此偏移绘制阴影，graphicsLayer 缩放整个图层 \u2192 屏幕空间偏移 = offset_orig * layerScale。映射回原始空间用于 SDF（offset_orig = offset_screen / layerScale 抵消），直接在原始空间用 uShadowOffset
    vec2 shadowCenteredOrig = centeredOrigRot - shadowOffsetRot;
    float sd = sdShape(shadowCenteredOrig, origHalfSize, origRadius);
    // 元素自身的 SDF（未偏移）\u2014 遮罩元素内部的阴影，使其不透过 AA 边缘渗出
    float elementSd = sdShape(centeredOrigRot, origHalfSize, origRadius);

    // 阴影强度：从阴影形状边缘的高斯衰减。uShadowRadius 单位原始 px，sigma = radius/3 与 BlurMaskFilter 扩散一致
    float sigma = max(uShadowRadius / 3.0, 1.0);
    float shadow = 0.5 * exp(-sd * sd / (2.0 * sigma * sigma));
    // 遮罩元素内部的阴影（元素覆盖了它）
    shadow *= smoothstep(-1.0, 1.0, elementSd);

    gl_FragColor = vec4(uShadowColor.rgb, uShadowColor.a * shadow);
}
`
  );
  var INNER_SHADOW_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uElementOffset;
uniform vec2  uElementSize;
uniform vec4  uCornerRadii;
uniform float uInnerShadowRadius;
uniform float uInnerShadowAlpha;
uniform vec2  uInnerShadowOffset;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uElementOffset;
    vec2 halfSize = uElementSize * 0.5;
    vec2 centeredCoord = localCoord - halfSize;

    float radius = radiusAt(centeredCoord, uCornerRadii);
    float sd = sdShape(centeredCoord, halfSize, radius);
    if (sd > 0.5) discard;

    vec2 innerCentered = centeredCoord - uInnerShadowOffset;
    float innerSd = sdShape(innerCentered, halfSize, radius);
    float band = smoothstep(uInnerShadowRadius, 0.0, innerSd);
    band *= step(0.0, innerSd);
    gl_FragColor = vec4(0.0, 0.0, 0.0, band * uInnerShadowAlpha * 0.5);
}
`
  );

  // shaders/highlight.ts
  var HIGHLIGHT_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;       // 元素左上角在画布 px 中（左上角原点）\u2014 缩放后的矩形
uniform vec2  uSize;         // 元素尺寸，单位画布 px \u2014 缩放后
uniform vec4  uCornerRadii;  // 胶囊半径 (topLeft, topRight, bottomRight, bottomLeft)，单位 px \u2014 缩放后
uniform vec4  uColor;        // rgba；通常为 white * (alpha = 0.15 * progress)
uniform float uRadius;       // 发光半径，单位画布 px (= minDim * 1.5, 缩放空间)
uniform vec2  uPosition;     // 手指位置，元素本地 px（左上角原点，缩放空间）
// 原始空间 SDF 裁剪（graphicsLayer { scaleX, scaleY }）：按压发光在 graphicsLayer 内部绘制，裁剪到原始胶囊形状后随图层缩放。发光位置+半径在缩放空间（屏幕 px 跟踪手指），裁剪 SDF 在原始空间，按钮拉伸时胶囊裁剪保持正确
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;

    // 原始空间的胶囊裁剪（graphicsLayer 裁剪）
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    float sd = sdShape(rotateBy(centeredOrig, -uElementRotation), origHalfSize, uOriginalCornerRadius);
    if (sd > 0.5) discard;
    float clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);

    // AGSL：smoothstep(radius, radius*0.5, dist) \u2192 intensity=1 当 dist<=radius*0.5，衰减到 0 当 dist>=radius。dist + uPosition 在缩放本地空间（手指跟踪屏幕 px）
    float dist = distance(localCoord, uPosition);
    float intensity = smoothstep(uRadius, uRadius * 0.5, dist);

    // 预乘 Plus 混合贡献。渲染器用 blendFunc(ONE, ONE) \u2192 result.rgb = contribution + dst.rgb（截断到 1）
    vec3 contribution = uColor.rgb * uColor.a * intensity * clipAlpha;
    gl_FragColor = vec4(contribution, 1.0);
}
`
  );
  var TINT_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform vec4  uColor;
// 原始空间 SDF 裁剪（graphicsLayer { scaleX, scaleY }）：白色覆盖层 (onDrawSurface drawRect) 在 graphicsLayer 内部绘制，裁剪到原始胶囊形状后随图层缩放。原始空间计算裁剪 SDF 使胶囊裁剪在按钮拉伸时保持正确（无圆角溢出，无拉伸裁剪伪影）
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    float sd = sdShape(rotateBy(centeredOrig, -uElementRotation), origHalfSize, uOriginalCornerRadius);
    if (sd > 0.5) discard;
    float clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sd);

    gl_FragColor = vec4(uColor.rgb, uColor.a * clipAlpha);
}
`
  );
  var RIM_HIGHLIGHT_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;          // 元素左上角在画布 px 中（左上角原点）\u2014 缩放后的矩形
uniform vec2  uSize;            // 元素尺寸，单位画布 px \u2014 缩放后（包含 graphicsLayer 缩放）
uniform vec4  uCornerRadii;     // (topLeft, topRight, bottomRight, bottomLeft)，单位 px \u2014 缩放后
uniform vec4  uHighlightColor;  // rgb + 1.0
uniform float uHighlightAngle;  // 弧度
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=Default, 1=Ambient, 2=Plain
uniform float uHighlightStrokeWidth;
uniform float uHighlightBlur;
// 原始空间 SDF（graphicsLayer { scaleX, scaleY }）：与 element shader 相同。原始空间计算 SDF/描边（形状不拉伸），高光裁剪+描边保持正确胶囊形状后由 graphicsLayer 缩放。否则水平拉伸按钮会拉伸高光裁剪使描边带不均匀
uniform vec2  uOriginalSize;        // 元素尺寸，单位 px（原始，未缩放）
uniform float uOriginalCornerRadius; // 圆角半径，单位 px（原始，未缩放）
uniform vec2  uLayerScale;          // 来自 graphicsLayer 的 (scaleX, scaleY)
uniform float uElementRotation;     // 旋转弧度（graphicsLayer rotationZ）

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    // elementCenter 对缩放和原始矩形相同（缩放围绕中心）
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    // 映射到原始空间（防止除以零）
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    // 反向旋转到元素的本地空间，使 SDF 形状旋转
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // 描边用 SDF \u2014 解析 sdRoundedRect。胶囊关闭时精确；胶囊开启时圆弧近似 G2 Bezier（差异在 2px 描边带内亚像素级，高光中不可见）
    float sd = sdRoundedRect(centeredOrigRot, origHalfSize, origRadius);

    // 形状外部 \u2014 裁剪（硬 discard，与胶囊前行为一致）
    if (sd > 0.0) discard;

    // 描边遮罩 \u2014 HighlightModifier.kt: style=Stroke, strokeWidth=ceil(width.toPx())*2 (完整描边以边缘为中心), blur=BlurMaskFilter(NORMAL), clipOutline 裁剪到形状内部, drawOutline 以边缘为中心描边。实现：先计算硬边缘描边遮罩，再通过沿梯度方向在多个偏移处采样 SDF 与高斯核卷积（镜像原始两步过程：绘制描边 \u2192 模糊，而非解析 erf 近似）。硬描边带 sd 在 [-strokeHalf, +strokeHalf]，裁剪后只显示 [-strokeHalf, 0]。
    // BlurMaskFilter: paint.blur(blurRadius.toPx()) \u2192 BlurMaskFilter(NORMAL, sigma=blurRadius_px)。Skia/Android 中 radius 参数即高斯 sigma（不是 radius/3）。blurRadius = width/2 = 0.25dp，sigma = 0.25*dpr px。uHighlightBlur 已是设备 px（渲染器设为 widthDp*dpr*0.5）
    float strokeHalf = uHighlightStrokeWidth * 0.5;
    float sigma = max(uHighlightBlur, 0.1);

    // 硬描边遮罩的高斯卷积 \u2014 3-tap（\u03C3 间距）。BlurMaskFilter \u03C3 = blurRadius = 0.25dp \u2192 dpr=1 时 0.25px。亚像素 sigma 下只需 3 个 tap（在 -\u03C3, 0, +\u03C3 处），\xB12\u03C3 处高斯权重 exp(-2) \u2248 0.14 可忽略。替换旧的 65-tap 循环（每像素 65 次 exp() ~650 周期 \u2014 单一最大 shader 开销）。3 tap = 3 次 exp() ~30 周期，\u03C3=0.25 时视觉结果完全相同，减少 20\xD7。hardMask(sd)=1.0 if |sd|<strokeHalf else 0.0；blurred(sd) = \u03A3 hardMask(sd-offset_k) * gauss(offset_k, \u03C3)。裁剪减半：描边以 sd=0 为中心，裁剪移除 sd>0（外侧半部分），峰值 \u2248 0.5，减半匹配
    float strokeMask = 0.0;
    float wSum = 0.0;
    for (int i = -1; i <= 1; i++) {
        float offset = float(i) * sigma;  // tap 位于 -\u03C3, 0, +\u03C3
        float sampleSd = sd - offset;
        float hard = (abs(sampleSd) < strokeHalf) ? 1.0 : 0.0;
        float w = exp(-0.5 * (offset * offset) / (sigma * sigma));
        strokeMask += hard * w;
        wSum += w;
    }
    strokeMask /= wSum;
    strokeMask *= 0.5;  // 裁剪将边缘处的对称描边减半

    if (uHighlightMode < 0.5) {
        // Default \u2014 shader 返回 color * intensity, Plus 混合
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        float intensity = pow(abs(d), uHighlightFalloff);
        vec3 c = uHighlightColor.rgb * intensity * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(c, 1.0);
    } else if (uHighlightMode < 1.5) {
        // Ambient \u2014 shader 返回 half4(t,t,t,1.0)*intensity, SrcOver 混合
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        float intensity = pow(abs(d), uHighlightFalloff);
        // 无 step(0,d) \u2014 两侧使用完整强度（无黑色边缘）
        float i = intensity * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(uHighlightColor.rgb * i, i);
    } else {
        // Plain \u2014 均匀描边, paint.color, Plus 混合
        vec3 c = uHighlightColor.rgb * strokeMask * uHighlightAlpha;
        gl_FragColor = vec4(c, 1.0);
    }
}
`
  );
  var HIGHLIGHT_STROKE_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;          // 元素左上角（左上角原点）\u2014 缩放后
uniform vec2  uSize;            // 元素尺寸 \u2014 缩放后
uniform vec4  uCornerRadii;     // 缩放后
uniform float uHighlightStrokeWidth;  // ceil(width*dpr)*2, 设备 px
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;
// uCornerStyle, uUseContinuousSdf, uContinuousSdf, uContinuousSdfTexSize,
// uContinuousSdfElementSize 在 SDF_GLSL 中声明（此处不要重新声明）。

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);

    // clipOutline \u2014 裁剪到形状内部。外部 (sd > 0) 被丢弃
    float edgeAA;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
        if (mask < 0.01) discard;
        edgeAA = mask;
    } else {
        if (sd > 0.0) discard;
        edgeAA = 1.0 - smoothstep(-0.5, 0.5, sd);
    }

    // 以边缘为中心的描边带 (sd=0)，内边界 0.5px 覆盖 AA。外边界 (sd=+strokeHalf) 被上方 edgeAA 裁剪掉（Skia Paint.Stroke 覆盖 AA）。BlurMaskFilter sigma>=0.5px 时进一步柔化；亚像素 sigma (0.25px) 跳过模糊，0.5px AA 匹配原始外观（Skia 0.25px 模糊几乎不可察觉，本质只是 AA）
    float strokeHalf = uHighlightStrokeWidth * 0.5;
    float strokeAA = 1.0 - smoothstep(strokeHalf - 0.5, strokeHalf, abs(sd));

    gl_FragColor = vec4(0.0, 0.0, 0.0, strokeAA * edgeAA);
}
`
  );
  var HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform sampler2D uBlurredMask;   // 2-pass 模糊后的描边遮罩 FBO
uniform vec2  uMaskTexSize;       // 遮罩 FBO 尺寸（= 画布尺寸）
uniform vec4  uHighlightColor;    // rgb + 1.0
uniform float uHighlightAngle;
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;     // 0=Default, 1=Ambient, 2=Plain
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;
// uCornerStyle, uUseContinuousSdf, uContinuousSdf, uContinuousSdfTexSize,
// uContinuousSdfElementSize 在 SDF_GLSL 中声明（此处不要重新声明）。

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

    // 采样模糊后的描边遮罩。遮罩 FBO 覆盖整个画布（相同尺寸），UV = gl_FragCoord / maskTexSize。遮罩 FBO 为 Y 向下（左上角原点，与场景 FBO 一致），翻转 Y 匹配 screenCoord 约定
    vec2 maskUv = vec2(gl_FragCoord.x / uMaskTexSize.x, gl_FragCoord.y / uMaskTexSize.y);
    float mask = texture2D(uBlurredMask, maskUv).a;
    if (mask < 0.001) discard;

    // 从 SDF 梯度计算强度 (AGSL DefaultHighlightShaderString)
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);
    vec2 origHalfSize = uOriginalSize * 0.5;
    float origRadius = uOriginalCornerRadius;

    // 模糊后裁剪：原始实现 clipOutline \u2192 stroke(blur)，但 Skia 在 BlurMaskFilter 扩散 alpha 后在画布级别应用裁剪，扩散到形状外部的 alpha 被裁剪掉。描边 shader 在模糊前裁剪（discard sd>0），模糊将 alpha 扩散回外部 \u2014 此处再次裁剪以匹配。否则高光"泄漏"到形状外部使其比原始实现更亮（原始实现在裁剪区域外贡献为零）
    float sd = sdShape(centeredOrigRot, origHalfSize, origRadius);
    float clipAA;
    if (uUseContinuousSdf > 0.5) {
        clipAA = sampleClipMask(centeredOrigRot, origHalfSize, origRadius);
    } else {
        clipAA = 1.0 - smoothstep(-0.5, 0.5, sd);
    }
    mask *= clipAA;
    if (mask < 0.001) discard;

    float intensity;
    if (uHighlightMode < 1.5) {
        // Default + Ambient 使用 SDF 梯度 \xB7 法线
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        intensity = pow(abs(d), uHighlightFalloff);
    } else {
        // Plain \u2014 无方向强度（均匀描边）
        intensity = 1.0;
    }

    float a = mask * uHighlightAlpha;

    if (uHighlightMode < 0.5) {
        // Default \u2014 Plus 混合。输出预乘 rgb（alpha=1，blendFunc(ONE, ONE) 直接相加 rgb）
        vec3 c = uHighlightColor.rgb * intensity * a;
        gl_FragColor = vec4(c, 1.0);
    } else if (uHighlightMode < 1.5) {
        // Ambient \u2014 SrcOver 混合，预乘输出。原始 Ambient 用 t=step(0,d)，此处保持 abs(d)（两侧都亮）匹配现有行为。原始 step 给出硬暗/亮分割，abs 给出对称发光
        float i = intensity * a;
        gl_FragColor = vec4(uHighlightColor.rgb * i, i);
    } else {
        // Plain \u2014 Plus 混合，无强度
        vec3 c = uHighlightColor.rgb * a;
        gl_FragColor = vec4(c, 1.0);
    }
}
`
  );
  var STROKE_MASK_COMPOSITE_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform sampler2D uStrokeMask;
uniform vec2  uMaskOffset;
uniform vec2  uMaskSize;
uniform vec4  uHighlightColor;
uniform float uHighlightAngle;
uniform float uHighlightFalloff;
uniform float uHighlightAlpha;
uniform float uHighlightMode;
uniform vec2  uOriginalSize;
uniform float uOriginalCornerRadius;
uniform vec2  uLayerScale;
uniform float uElementRotation;

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);

    // 屏幕坐标 \u2192 元素局部 ORIGINAL 空间（去缩放、去旋转）。
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 centeredOrigRot = rotateBy(centeredOrig, -uElementRotation);

    // 遮罩 UV：original 空间坐标 \u2192 遮罩纹理 UV；uMaskOffset=margin, uMaskSize=origSize+2*margin。
    vec2 origHalfSize = uOriginalSize * 0.5;
    vec2 maskTexCoord = centeredOrigRot + origHalfSize;  // 0..origSize（元素局部）
    vec2 maskUv = (maskTexCoord + uMaskOffset) / uMaskSize;
    if (maskUv.x < 0.0 || maskUv.x > 1.0 || maskUv.y < 0.0 || maskUv.y > 1.0) discard;
    float mask = texture2D(uStrokeMask, maskUv).a;
    if (mask < 0.001) discard;

    float origRadius = uOriginalCornerRadius;

    float intensity;
    if (uHighlightMode < 1.5) {
        float gradRadius = min(origRadius * 1.5, min(origHalfSize.x, origHalfSize.y));
        vec2 grad = gradSdRoundedRect(centeredOrigRot, origHalfSize, gradRadius);
        vec2 normal = vec2(cos(uHighlightAngle), sin(uHighlightAngle));
        float d = dot(grad, normal);
        intensity = pow(abs(d), uHighlightFalloff);
    } else {
        intensity = 1.0;
    }

    float a = mask * uHighlightAlpha;
    if (uHighlightMode < 0.5) {
        gl_FragColor = vec4(uHighlightColor.rgb * intensity * a, 1.0);
    } else if (uHighlightMode < 1.5) {
        float i = intensity * a;
        gl_FragColor = vec4(uHighlightColor.rgb * i, i);
    } else {
        gl_FragColor = vec4(uHighlightColor.rgb * a, 1.0);
    }
}
`
  );

  // shaders/scene-bg.ts
  var VERTEX_SHADER = (
    /* glsl */
    `
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}
`
  );
  var WALLPAPER_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uBackdrop;
uniform vec2 uCanvasSize;
uniform vec2 uWallpaperSize;

${COVER_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 uv = coverUv(screenCoord);
    gl_FragColor = texture2D(uBackdrop, uv);
}
`
  );
  var COPY_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uCanvasSize.x, gl_FragCoord.y / uCanvasSize.y);
    gl_FragColor = texture2D(uTexture, uv);
}
`
  );
  var SOLID_FILL_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec4 uColor;

void main() {
    gl_FragColor = uColor;
}
`
  );
  var COLOR_CONTROLS_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    vec4 c = texture2D(uTexture, uv);
    float invSat = 1.0 - uSaturation;
    float r = 0.213 * invSat;
    float g = 0.715 * invSat;
    float b = 0.072 * invSat;
    float t = (0.5 - uContrast * 0.5 + uBrightness);
    float cs = uContrast * uSaturation;
    float cr = uContrast * r;
    float cg = uContrast * g;
    float cb = uContrast * b;
    vec3 outc;
    outc.r = (cr + cs) * c.r + cg * c.g + cb * c.b + t;
    outc.g = cr * c.r + (cg + cs) * c.g + cb * c.b + t;
    outc.b = cr * c.r + cg * c.g + (cb + cs) * c.b + t;
    gl_FragColor = vec4(outc, c.a);
}
`
  );
  var SCENE_TINT_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;
uniform vec3 uTintColor;   // rgb 0..1（accentColor）

// ColorFilter.tint(SrcIn)：tint 颜色替换 RGB，保留 dst 的 alpha。
void main() {
    vec2 uv = vec2(gl_FragCoord.x / uCanvasSize.x, gl_FragCoord.y / uCanvasSize.y);
    vec4 src = texture2D(uTexture, uv);
    gl_FragColor = vec4(uTintColor, src.a);
}
`
  );

  // shaders/scene-fg.ts
  var FOREGROUND_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uCanvasSize;
uniform vec2 uOffset;   // 前景纹理左上角位置（px，SCALED）
uniform vec2 uSize;     // 前景纹理尺寸（px，SCALED）
uniform vec4 uCornerRadii;  // 胶囊半径（TL,TR,BR,BL，px，SCALED）
uniform float uAlpha;   // 全局 alpha 乘数（按下淡出）
// 裁剪在 ORIGINAL 空间计算 SDF（保留 graphicsLayer 缩放前的胶囊形状，避免角落溢出）；
// 纹理 UV 仍用 SCALED 矩形。
uniform vec2  uOriginalSize;        // 元素尺寸（px，ORIGINAL）
uniform float uOriginalCornerRadius; // 圆角半径（px，ORIGINAL）
uniform vec2  uLayerScale;          // graphicsLayer 的 (scaleX, scaleY)

${SDF_GLSL}

void main() {
    // 翻转 Y：framebuffer 左下角原点 \u2192 左上角原点（CSS 约定）。
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    // 裁剪到（缩放后的）前景矩形。
    if (localCoord.x < 0.0 || localCoord.x > uSize.x ||
        localCoord.y < 0.0 || localCoord.y > uSize.y) {
        discard;
    }

    // 屏幕坐标 \u2192 original 空间计算 SDF（裁剪为 original 胶囊，缩放围绕中心）。
    vec2 elementCenter = uOffset + uSize * 0.5;
    vec2 centeredScreen = screenCoord - elementCenter;
    vec2 layerScale = max(uLayerScale, vec2(1e-4));
    vec2 centeredOrig = centeredScreen / layerScale;
    vec2 origHalfSize = uOriginalSize * 0.5;
    float clipAlpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredOrig, origHalfSize, uOriginalCornerRadius);
        if (mask < 0.01) discard;
        clipAlpha = mask;
    } else {
        float sdClip = sdClipShape(centeredOrig, origHalfSize, uOriginalCornerRadius);
        if (sdClip > 0.5) discard;
        clipAlpha = 1.0 - smoothstep(-0.5, 0.5, sdClip);
    }

    // 纹理上传：UNPACK_FLIP_Y=false（v=0 对应顶部），UNPACK_PREMULTIPLY_ALPHA=true（c 已预乘）。
    // 输出预乘 rgba，配合 blendFunc(ONE, ONE_MINUS_SRC_ALPHA)。
    vec2 uv = localCoord / uSize;
    vec4 c = texture2D(uTexture, uv);
    float a = c.a * uAlpha * clipAlpha;
    gl_FragColor = vec4(c.rgb * uAlpha * clipAlpha, a);
}
`
  );
  var PLAIN_RECT_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform vec2  uCanvasSize;
uniform vec2  uOffset;
uniform vec2  uSize;
uniform vec4  uCornerRadii;
uniform vec4 uColor;       // rgba（无需预乘；alpha 按原样使用）

${SDF_GLSL}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    vec2 halfSize = uSize * 0.5;
    vec2 centeredCoord = localCoord - halfSize;

    float radius = radiusAt(centeredCoord, uCornerRadii);
    float alpha;
    if (uUseContinuousSdf > 0.5) {
        float mask = sampleClipMask(centeredCoord, halfSize, radius);
        if (mask < 0.01) discard;
        alpha = mask;
    } else {
        float sdClip = sdClipShape(centeredCoord, halfSize, radius);
        if (sdClip > 0.5) discard;
        alpha = 1.0 - smoothstep(-0.5, 0.5, sdClip);
    }
    gl_FragColor = vec4(uColor.rgb, uColor.a * alpha);
}
`
  );
  var PROGRESSIVE_BLUR_FRAGMENT_SHADER = (
    /* glsl */
    `
precision highp float;

uniform sampler2D uBackdrop;
uniform vec2  uCanvasSize;
uniform vec2  uWallpaperSize;
uniform vec2 uOffset;          // 条带在画布中的左上角位置（px，左上角为原点）
uniform vec2 uSize;            // 条带在画布中的尺寸（px）
uniform float uBlurRadius;      // 画布空间中的 px
uniform vec4  uTintColor;       // rgba
uniform float uTintIntensity;   // 0..1

${COVER_GLSL}

// 9 抖采样 poisson 圆盘（偏移内联：GLSL ES 1.00 不支持常量数组）。
vec4 sampleBackdrop(vec2 canvasPx, float radius) {
    vec2 uvScale = canvasPxToUvScale();
    vec2 uv = coverUv(canvasPx);
    vec2 st = radius * uvScale;
    vec4 sum = vec4(0.0);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.5000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.5000,  0.0000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000,  0.5000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.0000, -0.5000) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.3536,  0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.3536,  0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2( 0.3536, -0.3536) * st);
    sum += texture2D(uBackdrop, uv + vec2(-0.3536, -0.3536) * st);
    return sum / 9.0;
}

void main() {
    vec2 screenCoord = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
    vec2 localCoord = screenCoord - uOffset;
    // 条带外部 \u2014 无需绘制。
    if (localCoord.x < 0.0 || localCoord.x > uSize.x ||
        localCoord.y < 0.0 || localCoord.y > uSize.y) {
        discard;
    }

    // Alpha 遮罩：顶部不透明，底部透明（smoothstep 与 Kotlin 一致）。
    float a = smoothstep(uSize.y, uSize.y * 0.5, localCoord.y);

    // 在画图像素处采样（cover-fit）背景，已模糊。
    vec4 blurred = sampleBackdrop(screenCoord, uBlurRadius);

    // AlphaMask 着色器：mix(content*blurAlpha, tint*tintAlpha, tintIntensity)，输出预乘 rgb。
    vec3 premulRgb = mix(blurred.rgb * a, uTintColor.rgb * a, uTintIntensity);
    gl_FragColor = vec4(premulRgb, a);
}
`
  );

  // shaders/separable-blur.ts
  function generateGaussianKernel1D(tapCount) {
    if (tapCount <= 1) return [{ offset: 0, weight: 1 }];
    const taps = [];
    const half = Math.floor(tapCount / 2);
    const maxOffset = 3;
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const t = tapCount % 2 === 1 ? i - half : i - half + 0.5;
      const offset = t / half * maxOffset;
      const w = Math.exp(-0.5 * offset * offset);
      taps.push({ offset, weight: w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.weight /= totalW;
    }
    return taps;
  }
  function generateSeparableBlurShader(tapCount, direction) {
    const kernel = generateGaussianKernel1D(tapCount);
    const isH = direction === "horizontal";
    const dirVec = isH ? "vec2(1.0, 0.0)" : "vec2(0.0, 1.0)";
    let sampleCode = "";
    if (kernel.length === 1) {
      sampleCode = `    gl_FragColor = texture2D(uTexture, uv);
`;
    } else {
      sampleCode = `    vec3 rgbSum = vec3(0.0);
    float rgbW = 0.0;
`;
      for (const t of kernel) {
        const off = t.offset.toFixed(6);
        const w = t.weight.toFixed(8);
        sampleCode += `    { vec4 s = texture2D(uTexture, uv + ${dirVec} * ${off} * pxToUv); float aw = s.a * ${w}; rgbSum += s.rgb * aw; rgbW += aw; }
`;
      }
      sampleCode += `    float origA = texture2D(uTexture, uv).a;
    gl_FragColor = vec4(rgbW > 0.001 ? rgbSum / rgbW : vec3(0.0), origA);
`;
    }
    return (
      /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uRadius;

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    if (uRadius < 0.5) {
        gl_FragColor = texture2D(uTexture, uv);
        return;
    }
    vec2 pxToUv = vec2(uRadius / uTexSize.x, uRadius / uTexSize.y);
${sampleCode}}
`
    );
  }
  function computeBlur1DTapCount(blurRadiusPx) {
    if (blurRadiusPx < 0.5) return 1;
    const sigma = blurRadiusPx * 0.57735 + 0.5;
    const n = 2 * Math.ceil(3 * sigma) + 1;
    return Math.min(33, Math.max(1, n));
  }
  function generateHighlightBlurKernel1D(tapCount) {
    if (tapCount <= 1) return [{ offset: 0, weight: 1 }];
    const taps = [];
    const half = Math.floor(tapCount / 2);
    let totalW = 0;
    for (let i = 0; i < tapCount; i++) {
      const offset = i - half;
      const w = Math.exp(-0.5 * offset * offset);
      taps.push({ offset, weight: w });
      totalW += w;
    }
    if (totalW > 0) {
      for (const t of taps) t.weight /= totalW;
    }
    return taps;
  }
  function generateHighlightBlurShader(tapCount, direction) {
    const kernel = generateHighlightBlurKernel1D(tapCount);
    const isH = direction === "horizontal";
    const dirVec = isH ? "vec2(1.0, 0.0)" : "vec2(0.0, 1.0)";
    let sampleCode = "";
    if (kernel.length === 1) {
      sampleCode = `    gl_FragColor = texture2D(uTexture, uv);
`;
    } else {
      sampleCode = `    float aSum = 0.0;
`;
      for (const t of kernel) {
        const off = t.offset.toFixed(6);
        const w = t.weight.toFixed(8);
        sampleCode += `    aSum += texture2D(uTexture, uv + ${dirVec} * ${off} * pxToUv).a * ${w};
`;
      }
      sampleCode += `    gl_FragColor = vec4(0.0, 0.0, 0.0, aSum);
`;
    }
    return (
      /* glsl */
      `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform float uRadius;  // 像素单位的 Gaussian sigma（Android BlurMaskFilter 语义）

void main() {
    vec2 uv = vec2(gl_FragCoord.x / uTexSize.x, gl_FragCoord.y / uTexSize.y);
    if (uRadius < 0.01) {
        gl_FragColor = texture2D(uTexture, uv);
        return;
    }
    // pxToUv：像素偏移 \u2192 UV 偏移（offset\u03C3 * sigma_px / uTexSize）。
    vec2 pxToUv = vec2(uRadius / uTexSize.x, uRadius / uTexSize.y);
${sampleCode}}
`
    );
  }
  function computeHighlightBlurTapCount(sigmaPx) {
    if (sigmaPx < 0.01) return 1;
    const n = 2 * Math.ceil(3 * sigmaPx) + 1;
    return Math.min(33, Math.max(3, n));
  }

  // renderer/gl-utils.ts
  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("Shader compile error: " + log);
    }
    return sh;
  }
  function createProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error("Program link error: " + log);
    }
    return p;
  }
  function wrapText(ctx, text, maxW) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = "";
    for (const word of words) {
      const test = cur ? cur + " " + word : word;
      if (ctx.measureText(test).width <= maxW || !cur) {
        cur = test;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function easeIn(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const x1 = 0.42, y1 = 0, x2 = 1, y2 = 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const xs = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
      const dxs = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2);
      if (Math.abs(xs - t) < 1e-3) break;
      if (Math.abs(dxs) < 1e-6) break;
      s -= (xs - t) / dxs;
      s = Math.max(0, Math.min(1, s));
    }
    return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s;
  }

  // renderer/methods-fbo.ts
  var fboMethods = {
    gooseFBO(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { fb, tex };
    },
    gooseResizeFBO(w, h) {
      if (this.fboW === w && this.fboH === h && this.fboA && this.fboB) return;
      const gl = this.gl;
      if (this.fboA) gl.deleteFramebuffer(this.fboA);
      if (this.fboATex) gl.deleteTexture(this.fboATex);
      if (this.fboB) gl.deleteFramebuffer(this.fboB);
      if (this.fboBTex) gl.deleteTexture(this.fboBTex);
      const a = this.gooseFBO(w, h);
      const b = this.gooseFBO(w, h);
      this.fboA = a.fb;
      this.fboATex = a.tex;
      this.fboB = b.fb;
      this.fboBTex = b.tex;
      if (this.tabsBackdropFbo) gl.deleteFramebuffer(this.tabsBackdropFbo);
      if (this.tabsBackdropTex) gl.deleteTexture(this.tabsBackdropTex);
      const tb = this.gooseFBO(w, h);
      this.tabsBackdropFbo = tb.fb;
      this.tabsBackdropTex = tb.tex;
      this.tabsBackdropDirty = true;
      if (this.gpElementFbo) gl.deleteFramebuffer(this.gpElementFbo);
      if (this.gpElementTex) gl.deleteTexture(this.gpElementTex);
      if (this.blurFboA) gl.deleteFramebuffer(this.blurFboA);
      if (this.blurFboATex) gl.deleteTexture(this.blurFboATex);
      if (this.blurFboB) gl.deleteFramebuffer(this.blurFboB);
      if (this.blurFboBTex) gl.deleteTexture(this.blurFboBTex);
      const ge = this.gooseFBO(w, h);
      const ba = this.gooseFBO(w, h);
      const bb = this.gooseFBO(w, h);
      this.gpElementFbo = ge.fb;
      this.gpElementTex = ge.tex;
      this.blurFboA = ba.fb;
      this.blurFboATex = ba.tex;
      this.blurFboB = bb.fb;
      this.blurFboBTex = bb.tex;
      if (this.highlightMaskFbo) gl.deleteFramebuffer(this.highlightMaskFbo);
      if (this.highlightMaskTex) gl.deleteTexture(this.highlightMaskTex);
      const hm = this.gooseFBO(w, h);
      this.highlightMaskFbo = hm.fb;
      this.highlightMaskTex = hm.tex;
      if (this.dialogBackdropFbo) gl.deleteFramebuffer(this.dialogBackdropFbo);
      if (this.dialogBackdropTex) gl.deleteTexture(this.dialogBackdropTex);
      const db = this.gooseFBO(w, h);
      this.dialogBackdropFbo = db.fb;
      this.dialogBackdropTex = db.tex;
      this.dialogBackdropKey = null;
      this.fboW = w;
      this.fboH = h;
    },
    /** 将一个 FBO 绑定为 gooseRender 目标，视口设为其尺寸。 */
    gooseBindFBO(fb) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, this.fboW, this.fboH);
    },
    /** gooseCopy — 全屏拷贝 src 纹理到已绑定的 FBO（乒乓 blit 或最终到 canvas）。 */
    gooseCopy(srcTex) {
      const gl = this.gl;
      gl.useProgram(this.copyProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.aPosLocCp);
      gl.vertexAttribPointer(this.aPosLocCp, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.uCp["uTexture"], 0);
      gl.uniform2f(this.uCp["uCanvasSize"], this.fboW, this.fboH);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    /** gooseFill — 全屏纯色填充（用于 backgroundColor，如 Home 黑色）。调用方需先绑定 FBO。 */
    gooseFill(r, g, b, a) {
      const gl = this.gl;
      gl.useProgram(this.solidFillProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.aPosLocSf);
      gl.vertexAttribPointer(this.aPosLocSf, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.uSf["uColor"], r, g, b, a);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    /** gooseColorCtrl — 全屏拷贝 srcTex 到绑定的 FBO 并应用亮度/对比度/饱和度。 */
    gooseColorCtrl(srcTex, brightness, contrast, saturation) {
      const gl = this.gl;
      gl.useProgram(this.colorControlsProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.aPosLocCc);
      gl.vertexAttribPointer(this.aPosLocCc, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(this.uCc["uTexture"], 0);
      gl.uniform2f(this.uCc["uTexSize"], this.fboW, this.fboH);
      gl.uniform1f(this.uCc["uBrightness"], brightness);
      gl.uniform1f(this.uCc["uContrast"], contrast);
      gl.uniform1f(this.uCc["uSaturation"], saturation);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };

  // renderer/continuous-curve.ts
  var SQRT_2 = 1.4142135623730951;
  var FRAC_PI_4 = 0.7853981633974483;
  var FRAC_1_SQRT_2 = 0.7071067811865476;
  function solveCubicSingle(a, b, c, d) {
    const f = (3 * c / a - b * b / (a * a)) / 3;
    const g = (2 * b * b * b / (a * a * a) - 9 * b * c / (a * a) + 27 * d / a) / 27;
    const h = g * g / 4 + f * f * f / 27;
    const sqrtH = Math.sqrt(h);
    return Math.cbrt(-g / 2 + sqrtH) + Math.cbrt(-g / 2 - sqrtH) - b / (3 * a);
  }
  function solveDepressedQuarticSingle(p, q, r) {
    const b = -p / 2;
    const c = -r;
    const d = r * p / 2 - q * q / 8;
    const f = (3 * c - b * b) / 3;
    const g = (2 * b * b * b - 9 * b * c + 27 * d) / 27;
    const rVal = Math.sqrt(-f * f * f / 27);
    const phi = Math.acos(-g / (2 * rVal));
    const y = 2 * Math.sqrt(-f / 3) * Math.cos(phi / 3);
    const z = y - b / 3;
    const u = Math.sqrt(2 * z - p);
    return (u - Math.sqrt(u * u - 4 * (z + q / (2 * u)))) / 2;
  }
  var ContinuousCurvatureRoundedRectangleCornerBuilder = class {
    constructor(extendedFraction = 2 / 3, arcFraction = 0.5) {
      __publicField(this, "extendedFraction");
      __publicField(this, "arcFraction");
      __publicField(this, "theta");
      __publicField(this, "cos");
      __publicField(this, "sin");
      __publicField(this, "cot");
      __publicField(this, "cos2");
      __publicField(this, "sin2");
      __publicField(this, "cos3");
      __publicField(this, "sin3");
      __publicField(this, "k0");
      __publicField(this, "k1");
      __publicField(this, "k2");
      __publicField(this, "k3");
      this.extendedFraction = extendedFraction;
      this.arcFraction = arcFraction;
      this.theta = (1 - arcFraction) * FRAC_PI_4;
      this.cos = Math.cos(this.theta);
      this.sin = Math.sin(this.theta);
      this.cot = 1 / Math.tan(this.theta);
      this.cos2 = this.cos * this.cos;
      this.sin2 = this.sin * this.sin;
      this.cos3 = this.cos2 * this.cos;
      this.sin3 = this.sin2 * this.sin;
      const cos = this.cos;
      const sin = this.sin;
      const cot = this.cot;
      const cos2 = this.cos2;
      const sin2 = this.sin2;
      const cos3 = this.cos3;
      const sin3 = this.sin3;
      this.k0 = 27 * (SQRT_2 - 6 * cos + 6 * SQRT_2 * cos2 - 4 * cos3) * cot + 2 * sin * (-9 + 2 * (SQRT_2 - 2 * sin) * sin3 + 2 * SQRT_2 * cos * (9 + sin2) - 2 * cos2 * (9 + 2 * sin2));
      this.k1 = -81 * (-2 + SQRT_2 + 4 * (-1 + SQRT_2) * cos + 2 * (-2 + SQRT_2) * cos2) * cot - 4 * sin * (-9 + 9 * SQRT_2 + SQRT_2 * sin3 + (-2 + SQRT_2) * cos * (9 + sin2));
      this.k2 = 9 * (9 * (-4 + 3 * SQRT_2 + (-6 + 4 * SQRT_2) * cos) * cot + (-6 + 4 * SQRT_2) * sin);
      this.k3 = 27 * (10 - 7 * SQRT_2) * cot;
    }
    buildEvenCornerBezierPoints(t) {
      const k = this.extendedFraction * t;
      const kappa = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -k * this.sin3 * this.sin, this.k0);
      const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa;
      const y3 = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa;
      const x2 = x3 - y3 * this.cot;
      const x1 = x2 - 1.5 * kappa * y3 * y3 / this.sin3;
      const x0 = -k;
      const x6 = 1 - y3;
      const y6 = 1 - x3;
      const y7 = 1 - x2;
      const y8 = 1 - x1;
      const y9 = 1 - x0;
      const a = 1.5 * kappa;
      const g = this.cos2 - this.sin2;
      const x36 = x6 - x3;
      const y36 = y6 - y3;
      const c = -(this.cos * y36 - this.sin * x36);
      const lambda = (-g + Math.sqrt(g * g - 4 * a * c)) / (2 * a);
      const x4 = x3 + lambda * this.cos;
      const y4 = y3 + lambda * this.sin;
      const x5 = x6 - lambda * this.sin;
      const y5 = y6 - lambda * this.cos;
      return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
    }
    buildUnevenCornerBezierPoints(tH, tV) {
      const kH = this.extendedFraction * tH;
      const kV = this.extendedFraction * tV;
      const kappa3 = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -kH * this.sin3 * this.sin, this.k0);
      const kappa6 = solveCubicSingle(this.k3, this.k2, this.k1 + 8 * -kV * this.sin3 * this.sin, this.k0);
      const x3 = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa3;
      const y3 = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa3;
      const x2 = x3 - y3 * this.cot;
      const x1 = x2 - 1.5 * kappa3 * y3 * y3 / this.sin3;
      const x0 = -kH;
      const x3p = FRAC_1_SQRT_2 + (-FRAC_1_SQRT_2 + this.sin) / kappa6;
      const y3p = 1 - FRAC_1_SQRT_2 + (FRAC_1_SQRT_2 - this.cos) / kappa6;
      const x2p = x3p - y3p * this.cot;
      const x1p = x2p - 1.5 * kappa6 * y3p * y3p / this.sin3;
      const x0p = -kV;
      const x6 = 1 - y3p;
      const y6 = 1 - x3p;
      const y7 = 1 - x2p;
      const y8 = 1 - x1p;
      const y9 = 1 - x0p;
      const a = 1.5 * kappa3;
      const b = 1.5 * kappa6;
      const g = this.cos2 - this.sin2;
      const x36 = x6 - x3;
      const y36 = y6 - y3;
      const c = -(this.cos * y36 - this.sin * x36);
      const d = this.sin * y36 - this.cos * x36;
      const p = 2 * (d / b);
      const q = g * g * g / (a * b * b);
      const r = (a * d * d + c * g * g) / (a * b * b);
      const lambda6 = solveDepressedQuarticSingle(p, q, r);
      const lambda3 = (-d - b * lambda6 * lambda6) / g;
      const x4 = x3 + lambda3 * this.cos;
      const y4 = y3 + lambda3 * this.sin;
      const x5 = x6 - lambda6 * this.sin;
      const y5 = y6 - lambda6 * this.cos;
      return [x0, 0, x1, 0, x2, 0, x3, y3, x4, y4, x5, y5, x6, y6, 1, y7, 1, y8, 1, y9];
    }
    /** getCornerBezierPoints — 返回单角 20 个 Bezier 控制点（10 对，构成 G2 连续圆角的 3 段三次 Bezier）。tW/tH 限制到 [0,1]。 */
    getCornerBezierPoints(tW, tV) {
      const i = tW === 0 ? 0 : tW === 1 ? 1 : -1;
      const j = tV === 0 ? 0 : tV === 1 ? 1 : -1;
      if (i >= 0 && j >= 0) {
        if (i === 0 && j === 0) return this.buildEvenCornerBezierPoints(0);
        if (i === 1 && j === 1) return this.buildEvenCornerBezierPoints(1);
        return this.buildUnevenCornerBezierPoints(i === 1 ? 1 : 0, j === 1 ? 1 : 0);
      }
      return this.buildUnevenCornerBezierPoints(
        Math.max(0, Math.min(1, tW)),
        Math.max(0, Math.min(1, tV))
      );
    }
  };
  function continuousCurvatureRoundedRectPath(ctx, w, h, radius) {
    const builder = new ContinuousCurvatureRoundedRectangleCornerBuilder();
    const r = radius;
    const tW = Math.max(0, Math.min(1, (w * 0.5 - r) / r));
    const tH = Math.max(0, Math.min(1, (h * 0.5 - r) / r));
    const p = builder.getCornerBezierPoints(tW, tH);
    if (p.length < 20) return new Path2D();
    const path = new Path2D();
    let x = w - r;
    let y = 0;
    path.moveTo(x + p[0] * r, y + p[1] * r);
    path.bezierCurveTo(x + p[2] * r, y + p[3] * r, x + p[4] * r, y + p[5] * r, x + p[6] * r, y + p[7] * r);
    path.bezierCurveTo(x + p[8] * r, y + p[9] * r, x + p[10] * r, y + p[11] * r, x + p[12] * r, y + p[13] * r);
    path.bezierCurveTo(x + p[14] * r, y + p[15] * r, x + p[16] * r, y + p[17] * r, x + p[18] * r, y + p[19] * r);
    x = w - r;
    y = h;
    path.lineTo(x + p[18] * r, y - p[19] * r);
    path.bezierCurveTo(x + p[16] * r, y - p[17] * r, x + p[14] * r, y - p[15] * r, x + p[12] * r, y - p[13] * r);
    path.bezierCurveTo(x + p[10] * r, y - p[11] * r, x + p[8] * r, y - p[9] * r, x + p[6] * r, y - p[7] * r);
    path.bezierCurveTo(x + p[4] * r, y - p[5] * r, x + p[2] * r, y - p[3] * r, x + p[0] * r, y - p[1] * r);
    x = r;
    y = h;
    path.lineTo(x - p[0] * r, y - p[1] * r);
    path.bezierCurveTo(x - p[2] * r, y - p[3] * r, x - p[4] * r, y - p[5] * r, x - p[6] * r, y - p[7] * r);
    path.bezierCurveTo(x - p[8] * r, y - p[9] * r, x - p[10] * r, y - p[11] * r, x - p[12] * r, y - p[13] * r);
    path.bezierCurveTo(x - p[14] * r, y - p[15] * r, x - p[16] * r, y - p[17] * r, x - p[18] * r, y - p[19] * r);
    x = r;
    y = 0;
    path.lineTo(x - p[18] * r, y + p[19] * r);
    path.bezierCurveTo(x - p[16] * r, y + p[17] * r, x - p[14] * r, y + p[15] * r, x - p[12] * r, y + p[13] * r);
    path.bezierCurveTo(x - p[10] * r, y + p[11] * r, x - p[8] * r, y + p[9] * r, x - p[6] * r, y + p[7] * r);
    path.bezierCurveTo(x - p[4] * r, y + p[5] * r, x - p[2] * r, y + p[3] * r, x - p[0] * r, y + p[1] * r);
    path.closePath();
    return path;
  }

  // renderer/continuous-mask.ts
  var maskCache = /* @__PURE__ */ new Map();
  function generateContinuousCurvatureMask(w, h, radius, dpr = 1) {
    const texSize = Math.min(1024, Math.max(256, Math.round(Math.max(w, h) * dpr * 2)));
    const key = `${w},${h},${radius},${texSize}`;
    const cached = maskCache.get(key);
    if (cached) return { tex: cached.tex, texSize };
    const maxDim = Math.max(w, h);
    const aspectW = w / maxDim;
    const aspectH = h / maxDim;
    const canvas = document.createElement("canvas");
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, texSize, texSize);
    const margin = 4;
    const drawW = (texSize - 2 * margin) * aspectW;
    const drawH = (texSize - 2 * margin) * aspectH;
    const offsetX = (texSize - drawW) / 2;
    const offsetY = (texSize - drawH) / 2;
    const scale = drawW / w;
    const drawRadius = radius * scale;
    const path = continuousCurvatureRoundedRectPath(ctx, drawW, drawH, drawRadius);
    ctx.fillStyle = "white";
    ctx.translate(offsetX, offsetY);
    ctx.fill(path);
    ctx.translate(-offsetX, -offsetY);
    const imageData = ctx.getImageData(0, 0, texSize, texSize);
    const alpha = new Uint8Array(texSize * texSize);
    for (let i = 0; i < texSize * texSize; i++) {
      alpha[i] = imageData.data[i * 4 + 3];
    }
    const inside = new Float32Array(texSize * texSize);
    const outside = new Float32Array(texSize * texSize);
    const INF = 1e10;
    for (let i = 0; i < texSize * texSize; i++) {
      if (alpha[i] > 128) {
        inside[i] = 0;
        outside[i] = INF;
      } else {
        inside[i] = INF;
        outside[i] = 0;
      }
    }
    for (let y = 0; y < texSize; y++) {
      for (let x = 0; x < texSize; x++) {
        const idx = y * texSize + x;
        if (x > 0 && y > 1) {
          inside[idx] = Math.min(inside[idx], inside[idx - texSize - 1 - texSize] + 11);
          outside[idx] = Math.min(outside[idx], outside[idx - texSize - 1 - texSize] + 11);
        }
        if (x > 0) {
          inside[idx] = Math.min(inside[idx], inside[idx - 1] + 5);
          outside[idx] = Math.min(outside[idx], outside[idx - 1] + 5);
        }
        if (x > 0 && y > 0) {
          inside[idx] = Math.min(inside[idx], inside[idx - texSize - 1] + 7);
          outside[idx] = Math.min(outside[idx], outside[idx - texSize - 1] + 7);
        }
        if (y > 0) {
          inside[idx] = Math.min(inside[idx], inside[idx - texSize] + 5);
          outside[idx] = Math.min(outside[idx], outside[idx - texSize] + 5);
        }
        if (x < texSize - 1 && y > 0) {
          inside[idx] = Math.min(inside[idx], inside[idx - texSize + 1] + 7);
          outside[idx] = Math.min(outside[idx], outside[idx - texSize + 1] + 7);
        }
        if (x < texSize - 2 && y > 0) {
          inside[idx] = Math.min(inside[idx], inside[idx - texSize + 2] + 11);
          outside[idx] = Math.min(outside[idx], outside[idx - texSize + 2] + 11);
        }
      }
    }
    for (let y = texSize - 1; y >= 0; y--) {
      for (let x = texSize - 1; x >= 0; x--) {
        const idx = y * texSize + x;
        if (x < texSize - 1 && y < texSize - 2) {
          inside[idx] = Math.min(inside[idx], inside[idx + texSize + 1 + texSize] + 11);
          outside[idx] = Math.min(outside[idx], outside[idx + texSize + 1 + texSize] + 11);
        }
        if (x < texSize - 1) {
          inside[idx] = Math.min(inside[idx], inside[idx + 1] + 5);
          outside[idx] = Math.min(outside[idx], outside[idx + 1] + 5);
        }
        if (x < texSize - 1 && y < texSize - 1) {
          inside[idx] = Math.min(inside[idx], inside[idx + texSize + 1] + 7);
          outside[idx] = Math.min(outside[idx], outside[idx + texSize + 1] + 7);
        }
        if (y < texSize - 1) {
          inside[idx] = Math.min(inside[idx], inside[idx + texSize] + 5);
          outside[idx] = Math.min(outside[idx], outside[idx + texSize] + 5);
        }
        if (x > 0 && y < texSize - 1) {
          inside[idx] = Math.min(inside[idx], inside[idx + texSize - 1] + 7);
          outside[idx] = Math.min(outside[idx], outside[idx + texSize - 1] + 7);
        }
        if (x > 1 && y < texSize - 1) {
          inside[idx] = Math.min(inside[idx], inside[idx + texSize - 2] + 11);
          outside[idx] = Math.min(outside[idx], outside[idx + texSize - 2] + 11);
        }
      }
    }
    const refDist = drawRadius;
    const tex = new Uint8Array(texSize * texSize * 4);
    for (let i = 0; i < texSize * texSize; i++) {
      tex[i * 4] = alpha[i];
      const sd = (inside[i] - outside[i]) / 5;
      const normalized = Math.max(-1, Math.min(1, sd / refDist));
      tex[i * 4 + 1] = Math.round((normalized * 0.5 + 0.5) * 255);
      tex[i * 4 + 2] = 0;
      tex[i * 4 + 3] = 255;
    }
    maskCache.set(key, { tex, texSize });
    return { tex, texSize };
  }

  // renderer/methods-wallpaper.ts
  var wallpaperMethods = {
    /** 将壁纸图像作为纹理加载。 */
    async gooseLoadWP(src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load wallpaper: " + src));
        img.src = src;
      });
      const gl = this.gl;
      if (this.wallpaperTexture) gl.deleteTexture(this.wallpaperTexture);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const isPOT = (w & w - 1) === 0 && (h & h - 1) === 0;
      if (isPOT) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.wallpaperTexture = tex;
      this.wallpaperSize = [w || 1, h || 1];
      this.wallpaperReady = true;
      this.gooseReqRender();
    },
    /** 加载 SDF 纹理（clock_sdf），用于锁屏玻璃效果。 */
    async gooseLoadSDF(src) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load SDF texture: " + src));
        img.src = src;
      });
      const gl = this.gl;
      if (this.sdfTexture) gl.deleteTexture(this.sdfTexture);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.sdfTexture = tex;
      this.sdfTextureSize = [img.naturalWidth || 1, img.naturalHeight || 1];
      this.sdfTextureReady = true;
      this.gooseReqRender();
    },
    /** gooseLoadCSDF — 生成并上传连续曲率 SDF 纹理（对话框卡片胶囊形状）。纹理以 (w,h,radius) 缓存。
     *  G2 连续 Bezier squircle SDF 归一化到 [-1,1]（内负外正），像素级完美圆角。
     *  RGBA 纹理：R=SDF（着色器解码 sample*2-1），A=255，LINEAR/CLAMP_TO_EDGE。 */
    gooseLoadCSDF(w, h, radius) {
      const key = `${w},${h},${radius},${this.dpr}`;
      let entry = this.continuousSdfPool.get(key);
      if (!entry) {
        const { tex, texSize } = generateContinuousCurvatureMask(w, h, radius, this.dpr);
        const gl = this.gl;
        const texObj = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texObj);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texSize, texSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        entry = { tex: texObj, texSize };
        this.continuousSdfPool.set(key, entry);
        if (this.continuousSdfPool.size > 16) {
          const oldest = this.continuousSdfPool.keys().next().value;
          if (oldest) {
            const old = this.continuousSdfPool.get(oldest);
            if (old) gl.deleteTexture(old.tex);
            this.continuousSdfPool.delete(oldest);
          }
        }
      }
      this.continuousSdfTexture = entry.tex;
      this.continuousSdfTexSize = [entry.texSize, entry.texSize];
      this.continuousSdfKey = key;
    },
    /** gooseResize — 设置画布尺寸（CSS 像素）并处理 DPR。DPR 上限 1.5（软件着色器管线性能权衡）。 */
    gooseResize(cssW, cssH) {
      if (this.dpr <= 0) {
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      }
      const w = Math.round(cssW * this.dpr);
      const h = Math.round(cssH * this.dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);
        this.gooseResizeFBO(w, h);
      }
      for (const b of this.buttonConfigs) this.fgDirtyIds.add(b.id);
      this.cssWidth = cssW;
      this.cssHeight = cssH;
      this.gooseReqRender();
    }
  };

  // renderer/methods-scroll.ts
  var scrollMethods = {
    /** 可滚动内容的总高度（CSS 像素，由 React 层设置）。 */
    gooseContentH(h) {
      this.contentHeight = h;
      this.gooseClampY();
      this.gooseReqRender();
    },
    /** gooseScrollY — 直接设置滚动偏移（CSS 像素，正值=向下）。触摸拖动用，无弹簧滞后；速度重置 0，值限制到 [0, maxScroll]。 */
    gooseScrollY(y) {
      this.scrollVelocity = 0;
      this.scrollY = this.gooseClampScroll(y);
      this.gooseReqRender();
    },
    /** gooseScrollV — 施加惯性冲量（CSS 像素/秒）。触摸释放时用，指数衰减，无边缘弹簧回弹。 */
    gooseScrollV(v) {
      const MAX_VEL = 4e3;
      this.scrollVelocity = Math.max(-MAX_VEL, Math.min(MAX_VEL, v));
      this.gooseAnimStart();
    },
    /** 获取当前滚动偏移（CSS 像素）。 */
    gooseGetScrollY() {
      return this.scrollY;
    },
    /** 获取当前滚动速度（CSS 像素/秒，用于惯性）。 */
    gooseGetScrollV() {
      return this.scrollVelocity;
    },
    /** 将滚动值限制到 [0, maxScroll]。 */
    gooseClampScroll(y) {
      const max = Math.max(0, this.contentHeight - this.cssHeight);
      if (y < 0) return 0;
      if (y > max) return max;
      return y;
    },
    /** 原地限制当前 scrollY（在内容尺寸变化时调用）。 */
    gooseClampY() {
      this.scrollY = this.gooseClampScroll(this.scrollY);
    },
    /** gooseBG — 设置背景颜色覆盖；非 null 时用该颜色填充画布（不绘制壁纸），用于 Home 黑色背景。 */
    gooseBG(color) {
      this.backgroundColor = color;
      this.gooseReqRender();
    },
    gooseGravAngle(angleRad) {
      if (this.gravityAngle === angleRad) return;
      this.gravityAngle = angleRad;
      this.gooseReqRender();
    }
  };

  // renderer/velocity-tracker.ts
  var MAX_SAMPLES = 20;
  var VelocityTracker1D = class {
    constructor() {
      __publicField(this, "samples", []);
    }
    resetTracking() {
      this.samples.length = 0;
    }
    addPosition(timeMillis, position) {
      this.samples.push({ t: timeMillis, p: position });
      if (this.samples.length > MAX_SAMPLES) {
        this.samples.shift();
      }
    }
    /** calculateVelocity — 最小二乘线性拟合估计速度（单位/秒）。窗口默认 100ms（与 Compose 一致），样本<2 返回 0。 */
    calculateVelocity(windowMs = 100) {
      const samples = this.samples;
      if (samples.length < 2) return 0;
      const now = samples[samples.length - 1].t;
      const cutoff = now - windowMs;
      let n = 0;
      let sumT = 0;
      let sumP = 0;
      let sumTT = 0;
      let sumTP = 0;
      for (let i = samples.length - 1; i >= 0; i--) {
        const s = samples[i];
        if (s.t < cutoff) break;
        const tt = (s.t - now) / 1e3;
        sumT += tt;
        sumP += s.p;
        sumTT += tt * tt;
        sumTP += tt * s.p;
        n++;
      }
      if (n < 2) return 0;
      const denom = n * sumTT - sumT * sumT;
      if (Math.abs(denom) < 1e-9) return 0;
      const b = (n * sumTP - sumT * sumP) / denom;
      return b;
    }
  };

  // renderer/methods-toggle.ts
  var toggleMethods = {
    /** gooseEnsureTgl — 确保切换组状态存在并以 fraction 初始化。pressedScale/valueRangeSpan 首次创建时应用，非默认值时重应用。 */
    gooseEnsureTgl(groupId, initialFraction, pressedScale = 1.5, valueRangeSpan = 1) {
      let st = this.toggleStates.get(groupId);
      if (!st) {
        st = {
          fraction: initialFraction,
          fractionVelocity: 0,
          targetFraction: initialFraction,
          pressProgress: 0,
          pressVelocity: 0,
          targetPress: 0,
          scaleX: 1,
          scaleXVelocity: 0,
          targetScaleX: 1,
          scaleY: 1,
          scaleYVelocity: 0,
          targetScaleY: 1,
          velocity: 0,
          velocityVelocity: 0,
          targetVelocity: 0,
          isDragging: false,
          trackVelocityAfterRelease: false,
          velocityTracker: new VelocityTracker1D(),
          lastFractionForVelocity: initialFraction,
          lastFractionTime: 0,
          pressedScale,
          valueRangeSpan,
          panelOffset: 0,
          panelOffsetVelocity: 0,
          targetPanelOffset: 0
        };
        this.toggleStates.set(groupId, st);
      } else {
        if (pressedScale !== 1.5) st.pressedScale = pressedScale;
        if (valueRangeSpan !== 1) st.valueRangeSpan = valueRangeSpan;
      }
      return st;
    },
    /** gooseTglTarget — 设置切换目标 fraction（0..1），临界阻尼弹簧动画，触发按下-释放循环。
     *  目标未变化时为 no-op（防止 drag-end 后 React 重渲染重启按下动画的反馈循环）。 */
    gooseTglTarget(groupId, target) {
      const st = this.gooseEnsureTgl(groupId, target);
      if (st.isDragging) return;
      if (st.targetFraction === target) return;
      st.targetFraction = target;
      st.trackVelocityAfterRelease = false;
      st.targetVelocity = 0;
      st.velocity = 0;
      st.velocityVelocity = 0;
      st.velocityTracker.resetTracking();
      if (st.targetPress === 0) {
        st.targetPress = 1;
        st.targetScaleX = st.pressedScale;
        st.targetScaleY = st.pressedScale;
      }
      this.gooseAnimStart();
    },
    /** gooseTglDragStart — 开始手指拖动：isDragging=true，启动按下动画，重置 VelocityTracker。 */
    gooseTglDragStart(groupId, startFraction) {
      const st = this.gooseEnsureTgl(groupId, startFraction);
      st.isDragging = true;
      st.targetPress = 1;
      st.targetScaleX = st.pressedScale;
      st.targetScaleY = st.pressedScale;
      st.velocityTracker.resetTracking();
      st.targetVelocity = 0;
      st.velocity = 0;
      st.velocityVelocity = 0;
      this.gooseAnimStart();
    },
    /** gooseTglDrag — 更新切换目标 fraction：startFraction + (currentX-startX)/dragWidth，限制到 [0,1]。
     *  旋钮以临界阻尼弹簧跟随手指（带微小平滑滞后）。速度跟踪在动画循环中进行（最小二乘拟合）。 */
    gooseTglDrag(groupId, startFraction, currentX, startX, dragWidth) {
      const st = this.gooseEnsureTgl(groupId, startFraction);
      if (!st.isDragging) return;
      const delta = (currentX - startX) / Math.max(1, dragWidth);
      const newTarget = Math.max(0, Math.min(1, startFraction + delta));
      st.targetFraction = newTarget;
      this.gooseAnimStart();
    },
    /** gooseTglDragEnd — 结束拖动，将目标吸附到 0/1（≥0.5→1），返回吸附值。
     *  不立即释放按下动画：动画循环在 fraction 稳定到 targetFraction 附近（0.02 内）时自动释放。 */
    gooseTglDragEnd(groupId) {
      const st = this.toggleStates.get(groupId);
      if (!st) return 0;
      st.isDragging = false;
      const finalTarget = st.targetFraction >= 0.5 ? 1 : 0;
      st.targetFraction = finalTarget;
      st.trackVelocityAfterRelease = true;
      this.gooseAnimStart();
      return finalTarget;
    },
    /** gooseSldDragEnd — 结束滑块拖动（连续值，不吸附）。返回连续目标 fraction（0..1）。 */
    gooseSldDragEnd(groupId) {
      const st = this.toggleStates.get(groupId);
      if (!st) return 0;
      st.isDragging = false;
      const finalTarget = st.targetFraction;
      st.trackVelocityAfterRelease = true;
      this.gooseAnimStart();
      return finalTarget;
    },
    /** 读取切换组当前的动画 fraction（0..1）。 */
    gooseTglFrac(groupId) {
      var _a, _b;
      return (_b = (_a = this.toggleStates.get(groupId)) == null ? void 0 : _a.fraction) != null ? _b : 0;
    },
    /** gooseSldDragPos — 滑块拖动期间绝对设置 fraction（旋钮跳到手指位置，轨道拖动用）。isDragging 中也能工作。 */
    gooseSldDragPos(groupId, fraction) {
      const st = this.toggleStates.get(groupId);
      if (!st) return;
      const clamped = Math.max(0, Math.min(1, fraction));
      if (st.targetFraction !== clamped) {
        st.targetFraction = clamped;
        this.gooseAnimStart();
      }
    },
    /** 读取切换组当前的目标 fraction（0..1）。 */
    gooseTglTargetGet(groupId) {
      var _a, _b;
      return (_b = (_a = this.toggleStates.get(groupId)) == null ? void 0 : _a.targetFraction) != null ? _b : 0;
    }
  };

  // renderer/spring.ts
  var gooseDP = 1;
  var SPRING_K = 300;
  var SPRING_DAMPING_RATIO = 0.5;
  var SPRING_OMEGA_N = Math.sqrt(SPRING_K);
  var SPRING_OMEGA_D = SPRING_OMEGA_N * Math.sqrt(1 - SPRING_DAMPING_RATIO * SPRING_DAMPING_RATIO);
  var SPRING_THRESHOLD = 5e-4;
  var TOGGLE_VALUE_K = 1e3;
  var TOGGLE_VALUE_OMEGA_N = Math.sqrt(TOGGLE_VALUE_K);
  var TOGGLE_SCALE_X_K = 250;
  var TOGGLE_SCALE_X_DAMPING_RATIO = 0.6;
  var TOGGLE_SCALE_X_OMEGA_N = Math.sqrt(TOGGLE_SCALE_X_K);
  var TOGGLE_SCALE_X_OMEGA_D = TOGGLE_SCALE_X_OMEGA_N * Math.sqrt(1 - TOGGLE_SCALE_X_DAMPING_RATIO * TOGGLE_SCALE_X_DAMPING_RATIO);
  var TOGGLE_SCALE_Y_K = 250;
  var TOGGLE_SCALE_Y_DAMPING_RATIO = 0.7;
  var TOGGLE_SCALE_Y_OMEGA_N = Math.sqrt(TOGGLE_SCALE_Y_K);
  var TOGGLE_SCALE_Y_OMEGA_D = TOGGLE_SCALE_Y_OMEGA_N * Math.sqrt(1 - TOGGLE_SCALE_Y_DAMPING_RATIO * TOGGLE_SCALE_Y_DAMPING_RATIO);
  var TOGGLE_VELOCITY_K = 300;
  var TOGGLE_VELOCITY_DAMPING_RATIO = 0.5;
  var TOGGLE_VELOCITY_OMEGA_N = Math.sqrt(TOGGLE_VELOCITY_K);
  var TOGGLE_VELOCITY_OMEGA_D = TOGGLE_VELOCITY_OMEGA_N * Math.sqrt(1 - TOGGLE_VELOCITY_DAMPING_RATIO * TOGGLE_VELOCITY_DAMPING_RATIO);
  function springStep1D(current, velocity, target, dt) {
    const x0 = current - target;
    const v0 = velocity;
    const decay = Math.exp(-SPRING_DAMPING_RATIO * SPRING_OMEGA_N * dt);
    const cosWd = Math.cos(SPRING_OMEGA_D * dt);
    const sinWd = Math.sin(SPRING_OMEGA_D * dt);
    const offset = x0 * decay * cosWd + (v0 + SPRING_DAMPING_RATIO * SPRING_OMEGA_N * x0) / SPRING_OMEGA_D * decay * sinWd;
    const b0 = (v0 + SPRING_DAMPING_RATIO * SPRING_OMEGA_N * x0) / SPRING_OMEGA_D;
    const newVel = -SPRING_DAMPING_RATIO * SPRING_OMEGA_N * offset + decay * (-x0 * SPRING_OMEGA_D * sinWd + b0 * SPRING_OMEGA_D * cosWd);
    return { current: target + offset, velocity: newVel };
  }
  function springStepCritical(current, velocity, target, dt, omegaN) {
    const x0 = current - target;
    const v0 = velocity;
    const decay = Math.exp(-omegaN * dt);
    const offset = x0 * decay + (v0 + omegaN * x0) * dt * decay;
    const newVel = -omegaN * x0 * decay + (v0 + omegaN * x0) * (decay - omegaN * dt * decay);
    return { current: target + offset, velocity: newVel };
  }
  function springStepUnderdamped(current, velocity, target, dt, omegaN, dampingRatio) {
    const x0 = current - target;
    const v0 = velocity;
    const omegaD = omegaN * Math.sqrt(1 - dampingRatio * dampingRatio);
    const decay = Math.exp(-dampingRatio * omegaN * dt);
    const cosWd = Math.cos(omegaD * dt);
    const sinWd = Math.sin(omegaD * dt);
    const offset = x0 * decay * cosWd + (v0 + dampingRatio * omegaN * x0) / omegaD * decay * sinWd;
    const b0 = (v0 + dampingRatio * omegaN * x0) / omegaD;
    const newVel = -dampingRatio * omegaN * offset + decay * (-x0 * omegaD * sinWd + b0 * omegaD * cosWd);
    return { current: target + offset, velocity: newVel };
  }

  // renderer/methods-tabs.ts
  var tabsMethods = {
    /**
     * 设置 tab 指示器的目标索引。以临界阻尼弹簧
     * 动画。同时触发一个快速的按下-释放循环。
     */
    gooseTabSel(groupId, tabIndex, tabsCount) {
      const st = this.gooseEnsureTgl(
        groupId,
        tabIndex,
        LiquidGlassRenderer.gooseTabScale,
        tabsCount - 1
        // valueRangeSpan: 0..(tabsCount-1)
      );
      if (st.isDragging) return;
      if (st.targetFraction === tabIndex) return;
      st.targetFraction = tabIndex;
      st.trackVelocityAfterRelease = false;
      st.targetVelocity = 0;
      st.velocity = 0;
      st.velocityVelocity = 0;
      st.velocityTracker.resetTracking();
      if (st.targetPress === 0) {
        st.targetPress = 1;
        st.targetScaleX = st.pressedScale;
        st.targetScaleY = st.pressedScale;
      }
      this.gooseAnimStart();
    },
    /** gooseTabDragStart — 开始 tab 拖动：isDragging=true，启动按下动画。 */
    gooseTabDragStart(groupId, startTabIndex, tabsCount) {
      const st = this.gooseEnsureTgl(
        groupId,
        startTabIndex,
        LiquidGlassRenderer.gooseTabScale,
        tabsCount - 1
        // valueRangeSpan: 0..(tabsCount-1)
      );
      st.isDragging = true;
      st.targetPress = 1;
      st.targetScaleX = st.pressedScale;
      st.targetScaleY = st.pressedScale;
      st.velocityTracker.resetTracking();
      st.targetVelocity = 0;
      st.velocity = 0;
      st.velocityVelocity = 0;
      this.gooseAnimStart();
    },
    /** gooseTabDrag — 更新 tab 目标：startTabIndex + (currentX-startX)/tabWidth，限制到 [0, tabsCount-1]。
     *  panelOffset = 4dp * sign(fraction) * EaseOut(|fraction|)。速度跟踪在动画循环中进行。 */
    gooseTabDrag(groupId, startTabIndex, currentX, startX, tabWidth, tabsCount) {
      const st = this.gooseEnsureTgl(
        groupId,
        startTabIndex,
        LiquidGlassRenderer.gooseTabScale,
        tabsCount - 1
        // valueRangeSpan: 0..(tabsCount-1)
      );
      if (!st.isDragging) return;
      const delta = (currentX - startX) / Math.max(1, tabWidth);
      const newTarget = Math.max(0, Math.min(tabsCount - 1, startTabIndex + delta));
      st.targetFraction = newTarget;
      const maxWidth = tabWidth * tabsCount;
      const offsetFraction = Math.max(-1, Math.min(1, (currentX - startX) / Math.max(1, maxWidth)));
      const easeOut = 1 - Math.pow(1 - Math.abs(offsetFraction), 2);
      st.targetPanelOffset = 4 * gooseDP * Math.sign(offsetFraction) * easeOut;
      this.gooseAnimStart();
    },
    /** gooseTabDragEnd — 结束拖动，吸附到最近 tab 索引，返回吸附值。panelOffset 弹回 0（临界阻尼）。 */
    gooseTabDragEnd(groupId, tabsCount) {
      const st = this.toggleStates.get(groupId);
      if (!st) return 0;
      st.isDragging = false;
      const finalTarget = Math.round(st.targetFraction);
      const clamped = Math.max(0, Math.min(tabsCount - 1, finalTarget));
      st.targetFraction = clamped;
      st.velocityTracker.resetTracking();
      st.trackVelocityAfterRelease = false;
      st.targetVelocity = 0;
      st.targetPanelOffset = 0;
      this.gooseAnimStart();
      return clamped;
    },
    /** 读取当前动画 tab fraction（0..tabsCount-1）。 */
    gooseTabFrac(groupId) {
      var _a, _b;
      return (_b = (_a = this.toggleStates.get(groupId)) == null ? void 0 : _a.fraction) != null ? _b : 0;
    },
    /** 读取当前目标 tab 索引。 */
    gooseTabTarget(groupId) {
      var _a, _b;
      return (_b = (_a = this.toggleStates.get(groupId)) == null ? void 0 : _a.targetFraction) != null ? _b : 0;
    }
  };

  // renderer/methods-elements.ts
  var elementMethods = {
    /** 设置元素列表。对变化的元素触发前景重新光栅化。 */
    gooseElements(configs) {
      this.gooseButtons(configs);
    },
    /** 设置元素列表（旧名称；与 gooseElements 相同）。 */
    gooseButtons(configs) {
      var _a, _b;
      const prevIds = new Set(this.buttonConfigs.map((b) => b.id));
      const nextIds = new Set(configs.map((b) => b.id));
      for (const id of nextIds) if (!prevIds.has(id)) this.fgDirtyIds.add(id);
      for (const next of configs) {
        const prev = this.buttonConfigs.find((b) => b.id === next.id);
        if (!prev) continue;
        const eq4 = (a, b) => {
          if (!a || !b) return a === b;
          if (a.length !== b.length) return false;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
          return true;
        };
        const prevTextIcon = (_a = prev.text) == null ? void 0 : _a.icon;
        const nextTextIcon = (_b = next.text) == null ? void 0 : _b.icon;
        const textIconChanged = !!prevTextIcon !== !!nextTextIcon || prevTextIcon && nextTextIcon && (prevTextIcon.path !== nextTextIcon.path || prevTextIcon.size !== nextTextIcon.size || !eq4(prevTextIcon.color, nextTextIcon.color));
        const prevBtnIcon = prev.icon;
        const nextBtnIcon = next.icon;
        const btnIconChanged = !!prevBtnIcon !== !!nextBtnIcon || prevBtnIcon && nextBtnIcon && (prevBtnIcon.path !== nextBtnIcon.path || prevBtnIcon.size !== nextBtnIcon.size || !eq4(prevBtnIcon.color, nextBtnIcon.color));
        const pt = prev.text;
        const nt = next.text;
        const textPropsChanged = !!pt !== !!nt || pt && nt && (!eq4(pt.color, nt.color) || pt.halo !== nt.halo || pt.fontSizePx !== nt.fontSizePx || pt.fontWeight !== nt.fontWeight || pt.align !== nt.align || pt.wrap !== nt.wrap || pt.paddingPx !== nt.paddingPx || pt.valign !== nt.valign || pt.maxLines !== nt.maxLines);
        if (prev.label !== next.label || !eq4(prev.labelColor, next.labelColor) || prev.showChevron !== next.showChevron || prev.rect.w !== next.rect.w || prev.rect.h !== next.rect.h || next.text && prev.text && prev.text.content !== next.text.content || next.text && !prev.text || !next.text && prev.text || textIconChanged || btnIconChanged || textPropsChanged) {
          this.fgDirtyIds.add(next.id);
        }
      }
      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          this.buttonStates.delete(id);
          const tex = this.fgTextures.get(id);
          if (tex) {
            this.gl.deleteTexture(tex);
            this.fgTextures.delete(id);
          }
          this.fgDirtyIds.delete(id);
        }
      }
      for (const c of configs) {
        if (!this.buttonStates.has(c.id)) {
          const initValue = 0;
          this.buttonStates.set(c.id, {
            pressProgress: 0,
            pressVelocity: 0,
            targetPress: 0,
            dragX: 0,
            dragY: 0,
            dragVx: 0,
            dragVy: 0,
            targetDragX: 0,
            targetDragY: 0,
            startDragX: 0,
            startDragY: 0,
            interactiveValue: initValue,
            interactiveVelocity: 0,
            targetInteractiveValue: initValue
          });
        }
      }
      this.buttonConfigs = configs;
      this.gooseReqRender();
    },
    // gooseInterVal — 设置交互目标值（toggle/slider 为 0..1；tabbar 为整数索引），渲染器弹簧式逼近该值
    gooseInterVal(id, value) {
      const st = this.buttonStates.get(id);
      if (!st) return;
      if (st.targetInteractiveValue !== value) {
        st.targetInteractiveValue = value;
        this.gooseAnimStart();
        this.gooseReqRender();
      }
    },
    // goosePress — 设置按钮按下状态。position 为画布 CSS 像素坐标（原点左上角）。
    // 拖拽过程中位置瞬间跟随手指；释放时弹簧式回到起点。
    goosePress(id, pressed, position) {
      const st = this.buttonStates.get(id);
      if (!st) return;
      if (pressed) {
        const btn = this.buttonConfigs.find((b) => b.id === id);
        if (btn && position) {
          const localX = position.x - btn.rect.x;
          const localY = position.y - btn.rect.y;
          if (st.targetPress === 0) {
            st.startDragX = localX;
            st.startDragY = localY;
            st.dragX = localX;
            st.dragY = localY;
            st.dragVx = 0;
            st.dragVy = 0;
          }
          st.dragX = localX;
          st.dragY = localY;
          st.dragVx = 0;
          st.dragVy = 0;
          st.targetDragX = localX;
          st.targetDragY = localY;
        }
        st.targetPress = 1;
      } else {
        st.targetPress = 0;
        st.targetDragX = st.startDragX;
        st.targetDragY = st.startDragY;
      }
      this.gooseAnimStart();
    },
    // gooseDragPos — 按下状态下更新拖拽位置（不改变按下状态），用于 pointermove 事件。位置瞬间跟随手指。
    gooseDragPos(id, position) {
      const st = this.buttonStates.get(id);
      if (!st || st.targetPress === 0) return;
      const btn = this.buttonConfigs.find((b) => b.id === id);
      if (!btn) return;
      const localX = position.x - btn.rect.x;
      const localY = position.y - btn.rect.y;
      st.dragX = localX;
      st.dragY = localY;
      st.dragVx = 0;
      st.dragVy = 0;
      st.targetDragX = localX;
      st.targetDragY = localY;
      this.gooseReqRender();
    }
  };

  // renderer/methods-animation.ts
  var animationMethods = {
    // gooseAnimStart — 弹簧动画循环（欠阻尼，释放时轻微过冲）。使用真实挂钟 dt 实现帧率无关时序。
    gooseAnimStart() {
      if (this.animRafId !== null) return;
      let lastTime = performance.now();
      const tick = () => {
        const now = performance.now();
        const dt = Math.min((now - lastTime) / 1e3, 0.05);
        lastTime = now;
        let stillAnimating = false;
        for (const st of this.buttonStates.values()) {
          const pDelta = Math.abs(st.targetPress - st.pressProgress);
          if (pDelta > SPRING_THRESHOLD || Math.abs(st.pressVelocity) > SPRING_THRESHOLD) {
            const r = springStep1D(
              st.pressProgress,
              st.pressVelocity,
              st.targetPress,
              dt
            );
            st.pressProgress = r.current;
            st.pressVelocity = r.velocity;
            stillAnimating = true;
          } else {
            st.pressProgress = st.targetPress;
            st.pressVelocity = 0;
          }
          if (Math.abs(st.targetDragX - st.dragX) > SPRING_THRESHOLD || Math.abs(st.dragVx) > SPRING_THRESHOLD) {
            const r = springStep1D(st.dragX, st.dragVx, st.targetDragX, dt);
            st.dragX = r.current;
            st.dragVx = r.velocity;
            stillAnimating = true;
          } else {
            st.dragX = st.targetDragX;
            st.dragVx = 0;
          }
          if (Math.abs(st.targetDragY - st.dragY) > SPRING_THRESHOLD || Math.abs(st.dragVy) > SPRING_THRESHOLD) {
            const r = springStep1D(st.dragY, st.dragVy, st.targetDragY, dt);
            st.dragY = r.current;
            st.dragVy = r.velocity;
            stillAnimating = true;
          } else {
            st.dragY = st.targetDragY;
            st.dragVy = 0;
          }
          const iDelta = Math.abs(st.targetInteractiveValue - st.interactiveValue);
          if (iDelta > SPRING_THRESHOLD || Math.abs(st.interactiveVelocity) > SPRING_THRESHOLD) {
            const r = springStep1D(
              st.interactiveValue,
              st.interactiveVelocity,
              st.targetInteractiveValue,
              dt
            );
            st.interactiveValue = r.current;
            st.interactiveVelocity = r.velocity;
            stillAnimating = true;
          } else {
            st.interactiveValue = st.targetInteractiveValue;
            st.interactiveVelocity = 0;
          }
        }
        for (const tg of this.toggleStates.values()) {
          if (tg.targetPress === 1 && !tg.isDragging && Math.abs(tg.targetFraction - tg.fraction) < 0.02) {
            tg.targetPress = 0;
            tg.targetScaleX = 1;
            tg.targetScaleY = 1;
            this.gooseAnimStart();
          }
          const fDelta = Math.abs(tg.targetFraction - tg.fraction);
          if (fDelta > SPRING_THRESHOLD || Math.abs(tg.fractionVelocity) > SPRING_THRESHOLD) {
            const r = springStepCritical(
              tg.fraction,
              tg.fractionVelocity,
              tg.targetFraction,
              dt,
              TOGGLE_VALUE_OMEGA_N
            );
            tg.fraction = r.current;
            tg.fractionVelocity = r.velocity;
            if (tg.trackVelocityAfterRelease || tg.isDragging) {
              const nowMs = performance.now();
              tg.velocityTracker.addPosition(nowMs, tg.fraction);
              const tracked = tg.velocityTracker.calculateVelocity();
              const span = tg.valueRangeSpan || 1;
              tg.targetVelocity = tracked / span;
            }
            stillAnimating = true;
          } else {
            tg.fraction = tg.targetFraction;
            tg.fractionVelocity = 0;
            if (!tg.isDragging) {
              tg.targetVelocity = 0;
              tg.trackVelocityAfterRelease = false;
              tg.velocityTracker.resetTracking();
            }
          }
          const ppDelta = Math.abs(tg.targetPress - tg.pressProgress);
          if (ppDelta > SPRING_THRESHOLD || Math.abs(tg.pressVelocity) > SPRING_THRESHOLD) {
            const r = springStepCritical(
              tg.pressProgress,
              tg.pressVelocity,
              tg.targetPress,
              dt,
              TOGGLE_VALUE_OMEGA_N
            );
            tg.pressProgress = r.current;
            tg.pressVelocity = r.velocity;
            stillAnimating = true;
          } else {
            tg.pressProgress = tg.targetPress;
            tg.pressVelocity = 0;
          }
          const sx = Math.abs(tg.targetScaleX - tg.scaleX);
          if (sx > SPRING_THRESHOLD || Math.abs(tg.scaleXVelocity) > SPRING_THRESHOLD) {
            const r = springStepUnderdamped(
              tg.scaleX,
              tg.scaleXVelocity,
              tg.targetScaleX,
              dt,
              TOGGLE_SCALE_X_OMEGA_N,
              TOGGLE_SCALE_X_DAMPING_RATIO
            );
            tg.scaleX = r.current;
            tg.scaleXVelocity = r.velocity;
            stillAnimating = true;
          } else {
            tg.scaleX = tg.targetScaleX;
            tg.scaleXVelocity = 0;
          }
          const sy = Math.abs(tg.targetScaleY - tg.scaleY);
          if (sy > SPRING_THRESHOLD || Math.abs(tg.scaleYVelocity) > SPRING_THRESHOLD) {
            const r = springStepUnderdamped(
              tg.scaleY,
              tg.scaleYVelocity,
              tg.targetScaleY,
              dt,
              TOGGLE_SCALE_Y_OMEGA_N,
              TOGGLE_SCALE_Y_DAMPING_RATIO
            );
            tg.scaleY = r.current;
            tg.scaleYVelocity = r.velocity;
            stillAnimating = true;
          } else {
            tg.scaleY = tg.targetScaleY;
            tg.scaleYVelocity = 0;
          }
          const vDelta = Math.abs(tg.targetVelocity - tg.velocity);
          if (vDelta > SPRING_THRESHOLD || Math.abs(tg.velocityVelocity) > SPRING_THRESHOLD) {
            const r = springStepUnderdamped(
              tg.velocity,
              tg.velocityVelocity,
              tg.targetVelocity,
              dt,
              TOGGLE_VELOCITY_OMEGA_N,
              TOGGLE_VELOCITY_DAMPING_RATIO
            );
            tg.velocity = r.current;
            tg.velocityVelocity = r.velocity;
            stillAnimating = true;
          } else {
            tg.velocity = tg.targetVelocity;
            tg.velocityVelocity = 0;
          }
          const poDelta = Math.abs(tg.targetPanelOffset - tg.panelOffset);
          if (poDelta > SPRING_THRESHOLD || Math.abs(tg.panelOffsetVelocity) > SPRING_THRESHOLD) {
            const r = springStepCritical(
              tg.panelOffset,
              tg.panelOffsetVelocity,
              tg.targetPanelOffset,
              dt,
              Math.sqrt(300)
              // ω_n = sqrt(k) = sqrt(300) ≈ 17.32
            );
            tg.panelOffset = r.current;
            tg.panelOffsetVelocity = r.velocity;
            stillAnimating = true;
          } else {
            tg.panelOffset = tg.targetPanelOffset;
            tg.panelOffsetVelocity = 0;
          }
        }
        if (Math.abs(this.scrollVelocity) > 0.5) {
          const SCROLL_DECAY = 4;
          const newScrollY = this.scrollY + this.scrollVelocity * dt;
          const clamped = this.gooseClampScroll(newScrollY);
          if (clamped !== newScrollY) {
            this.scrollY = clamped;
            this.scrollVelocity = 0;
          } else {
            this.scrollY = clamped;
            this.scrollVelocity *= Math.exp(-SCROLL_DECAY * dt);
          }
          stillAnimating = true;
        } else {
          this.scrollVelocity = 0;
        }
        this.gooseReqRender();
        if (stillAnimating) {
          this.animRafId = requestAnimationFrame(tick);
        } else {
          this.animRafId = null;
        }
      };
      this.animRafId = requestAnimationFrame(tick);
    },
    gooseReqRender() {
      this.needsRedraw = true;
      if (this.rafId !== null) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.gooseRender();
      });
    }
  };

  // renderer/methods-raster.ts
  var rasterMethods = {
    gooseRaster(cfg) {
      var _a, _b;
      if (cfg.kind === "text" && cfg.text) {
        this.gooseRasterText(cfg);
        return;
      }
      if (cfg.kind !== "button" && !cfg.label && !cfg.icon) {
        this.fgDirtyIds.delete(cfg.id);
        return;
      }
      const dpr = this.dpr;
      const w = Math.max(1, Math.round(cfg.rect.w * dpr));
      const h = Math.max(1, Math.round(cfg.rect.h * dpr));
      if (this.fgCanvas.width !== w) this.fgCanvas.width = w;
      if (this.fgCanvas.height !== h) this.fgCanvas.height = h;
      const ctx = this.fgCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.scale(dpr, dpr);
      const cssW = cfg.rect.w;
      const cssH = cfg.rect.h;
      if (cfg.icon) {
        const iconSize = cfg.icon.size;
        const ic = cfg.icon.color;
        ctx.save();
        ctx.translate(cssW / 2 - iconSize / 2, cssH / 2 - iconSize / 2);
        const vp = (_a = cfg.icon.viewport) != null ? _a : 24;
        ctx.scale(iconSize / vp, iconSize / vp);
        const p = new Path2D(cfg.icon.path);
        ctx.fillStyle = `rgba(${Math.round(ic[0] * 255)}, ${Math.round(
          ic[1] * 255
        )}, ${Math.round(ic[2] * 255)}, ${ic[3]})`;
        ctx.fill(p);
        ctx.restore();
        this.gooseUploadRaster(cfg.id);
        this.fgDirtyIds.delete(cfg.id);
        return;
      }
      const fontPx = (_b = cfg.labelFontSizePx) != null ? _b : cssH * (15 / 48);
      const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.font = `400 ${fontPx}px ${fontFamily}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const colorStr = `rgba(${Math.round(cfg.labelColor[0] * 255)}, ${Math.round(
        cfg.labelColor[1] * 255
      )}, ${Math.round(cfg.labelColor[2] * 255)}, ${cfg.labelColor[3]})`;
      const haloIsLight = cfg.labelColor[0] + cfg.labelColor[1] + cfg.labelColor[2] < 1.5;
      ctx.save();
      ctx.shadowColor = haloIsLight ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.15)";
      ctx.shadowBlur = haloIsLight ? fontPx * 0.12 : fontPx * 0.05;
      ctx.fillStyle = colorStr;
      ctx.fillText(cfg.label, cssW / 2, cssH / 2 + 0.5);
      ctx.restore();
      if (cfg.showChevron) {
        const chevronSize = fontPx * 0.93;
        const labelWidth = ctx.measureText(cfg.label).width;
        const cx = cssW / 2 + labelWidth / 2 + fontPx * 0.53 + chevronSize / 2;
        const cy = cssH / 2;
        ctx.save();
        ctx.strokeStyle = colorStr;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = fontPx * 0.107;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(cx - chevronSize * 0.3, cy - chevronSize * 0.4);
        ctx.lineTo(cx + chevronSize * 0.2, cy);
        ctx.lineTo(cx - chevronSize * 0.3, cy + chevronSize * 0.4);
        ctx.stroke();
        ctx.restore();
      }
      this.gooseUploadRaster(cfg.id);
      this.fgDirtyIds.delete(cfg.id);
    },
    // gooseRasterText — 文本元素光栅化（支持自动换行），绘制到前景纹理
    gooseRasterText(cfg) {
      var _a, _b, _c;
      if (!cfg.text) return;
      const dpr = this.dpr;
      const w = Math.max(1, Math.round(cfg.rect.w * dpr));
      const h = Math.max(1, Math.round(cfg.rect.h * dpr));
      if (this.fgCanvas.width !== w) this.fgCanvas.width = w;
      if (this.fgCanvas.height !== h) this.fgCanvas.height = h;
      const ctx = this.fgCtx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.scale(dpr, dpr);
      const t = cfg.text;
      const cssW = cfg.rect.w;
      const cssH = cfg.rect.h;
      const fontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.font = `${t.fontWeight} ${t.fontSizePx}px ${fontFamily}`;
      ctx.textBaseline = "middle";
      const pad = (_a = t.paddingPx) != null ? _a : 0;
      let halo = "none";
      if (t.halo === "light") halo = "light";
      else if (t.halo === "dark") halo = "dark";
      else if (t.halo === "auto" || t.halo === void 0) {
        const bright = t.color[0] + t.color[1] + t.color[2];
        halo = bright < 1.5 ? "light" : "dark";
      }
      if (halo === "light") {
        ctx.shadowColor = "rgba(255,255,255,0.55)";
        ctx.shadowBlur = t.fontSizePx * 0.16;
      } else if (halo === "dark") {
        ctx.shadowColor = "rgba(0,0,0,0.28)";
        ctx.shadowBlur = t.fontSizePx * 0.1;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      const colorStr = `rgba(${Math.round(t.color[0] * 255)}, ${Math.round(
        t.color[1] * 255
      )}, ${Math.round(t.color[2] * 255)}, ${t.color[3]})`;
      ctx.fillStyle = colorStr;
      let textYOffset = 0;
      if (t.icon) {
        const iconDrawSize = t.icon.size;
        const iconLayoutSize = (_b = t.icon.layoutSize) != null ? _b : iconDrawSize;
        const gap = t.content ? 2 : 0;
        const totalBlockH = iconLayoutSize + gap + (t.content ? t.fontSizePx : 0);
        const blockTop = cssH / 2 - totalBlockH / 2;
        const iconCx = cssW / 2;
        const iconCy = blockTop + iconLayoutSize / 2;
        ctx.save();
        ctx.translate(iconCx - iconDrawSize / 2, iconCy - iconDrawSize / 2);
        const vp = (_c = t.icon.viewport) != null ? _c : 24;
        ctx.scale(iconDrawSize / vp, iconDrawSize / vp);
        const p = new Path2D(t.icon.path);
        const ic = t.icon.color;
        ctx.fillStyle = `rgba(${Math.round(ic[0] * 255)}, ${Math.round(
          ic[1] * 255
        )}, ${Math.round(ic[2] * 255)}, ${ic[3]})`;
        ctx.fill(p);
        ctx.restore();
        textYOffset = (iconLayoutSize + gap) / 2;
      }
      if (t.align === "center") {
        ctx.textAlign = "center";
        if (t.wrap) {
          let lines = wrapText(ctx, t.content, cssW - pad * 2);
          if (t.maxLines != null && lines.length > t.maxLines) {
            lines = lines.slice(0, t.maxLines);
          }
          const lineH = t.fontSizePx * 1.35;
          const totalH = lineH * lines.length;
          let y;
          if (t.valign === "top") {
            y = lineH / 2 + textYOffset;
          } else if (t.valign === "bottom") {
            y = cssH - totalH + lineH / 2 + textYOffset;
          } else {
            y = cssH / 2 - totalH / 2 + lineH / 2 + textYOffset;
          }
          for (const line of lines) {
            ctx.fillText(line, cssW / 2, y);
            y += lineH;
          }
        } else {
          ctx.fillText(t.content, cssW / 2, cssH / 2 + 0.5 + textYOffset);
        }
      } else if (t.align === "left") {
        ctx.textAlign = "left";
        if (t.wrap) {
          let lines = wrapText(ctx, t.content, cssW - pad * 2);
          if (t.maxLines != null && lines.length > t.maxLines) {
            lines = lines.slice(0, t.maxLines);
          }
          const lineH = t.fontSizePx * 1.35;
          const totalH = lineH * lines.length;
          let y;
          if (t.valign === "top") {
            y = lineH / 2 + textYOffset;
          } else if (t.valign === "bottom") {
            y = cssH - totalH + lineH / 2 + textYOffset;
          } else {
            y = cssH / 2 - totalH / 2 + lineH / 2 + textYOffset;
          }
          for (const line of lines) {
            ctx.fillText(line, pad, y);
            y += lineH;
          }
        } else {
          ctx.fillText(t.content, pad, cssH / 2 + 0.5 + textYOffset);
        }
      } else {
        ctx.textAlign = "right";
        ctx.fillText(t.content, cssW - pad, cssH / 2 + 0.5 + textYOffset);
      }
      this.gooseUploadRaster(cfg.id);
      this.fgDirtyIds.delete(cfg.id);
    },
    gooseUploadRaster(id) {
      const gl = this.gl;
      let tex = this.fgTextures.get(id);
      if (!tex) {
        tex = gl.createTexture();
        this.fgTextures.set(id, tex);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.fgCanvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }
  };

  // renderer/methods-render.ts
  var renderMethods = {
    gooseRender() {
      if (!this.needsRedraw) return;
      this.needsRedraw = false;
      if (!this.wallpaperReady && !this.backgroundColor) return;
      const gl = this.gl;
      this.gooseResizeFBO(this.canvas.width, this.canvas.height);
      for (const cfg of this.buttonConfigs) {
        if (this.fgDirtyIds.has(cfg.id)) {
          this.gooseRaster(cfg);
        }
      }
      this.gooseRenderBG();
      if (this.buttonConfigs.length === 0) {
        this.gooseBindFBO(null);
        this.gooseCopy(this.fboATex);
        return;
      }
      const sceneBlurEl = this.buttonConfigs.find((e) => {
        var _a;
        return ((_a = e.sceneBlurRadius) != null ? _a : 0) >= 0.5;
      });
      if (sceneBlurEl) {
        const r = sceneBlurEl.sceneBlurRadius * this.dpr;
        const blurred = this.gooseBlur(this.fboATex, r);
        this.gooseBindFBO(this.fboA);
        this.gooseCopy(blurred);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const scrollY = this.scrollY;
      const CULL_MARGIN = 120;
      const viewportTop = -CULL_MARGIN;
      const viewportBottom = this.cssHeight + CULL_MARGIN;
      const effRect = (el) => {
        const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
        return { x: el.rect.x, y, w: el.rect.w, h: el.rect.h };
      };
      let curFbo = this.fboA;
      let curTex = this.fboATex;
      let otherFbo = this.fboB;
      let otherTex = this.fboBTex;
      for (const el of this.buttonConfigs) {
        if (el.renderOnTop) continue;
        const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
        if (y + el.rect.h < viewportTop || y > viewportBottom) continue;
        const r = effRect(el);
        const st = this.buttonStates.get(el.id);
        if (this.gooseRenderPlain(el, r, st, curFbo)) continue;
        if (el.backdropFbo && el.scrimColor) {
          this.gooseRenderDlg(el.scrimColor, el.brightness, el.contrast, el.saturation);
        }
        if (el.useContinuousSdf) {
          this.gooseLoadCSDF(el.rect.w, el.rect.h, el.cornerRadius);
        }
        const result = this.gooseRenderGlass(el, st, curFbo, curTex, otherFbo, otherTex, r);
        curFbo = result.curFbo;
        curTex = result.curTex;
        otherFbo = result.otherFbo;
        otherTex = result.otherTex;
        if (el.isBottomTabContainer && this.tabsBackdropFbo && this.tabsBackdropTex) {
          this.gooseBindFBO(this.tabsBackdropFbo);
          this.gl.clearColor(0, 0, 0, 0);
          this.gl.clear(this.gl.COLOR_BUFFER_BIT);
          this.gooseCopy(curTex);
          this.gooseBindFBO(curFbo);
          this.gl.enable(this.gl.BLEND);
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        }
      }
      for (const el of this.buttonConfigs) {
        if (!el.renderOnTop) continue;
        const y = el.scroll ? el.rect.y - scrollY : el.rect.y;
        if (y + el.rect.h < viewportTop || y > viewportBottom) continue;
        const r = effRect(el);
        const st = this.buttonStates.get(el.id);
        if (this.gooseRenderPlain(el, r, st, curFbo)) continue;
        const result = this.gooseRenderGlass(el, st, curFbo, curTex, otherFbo, otherTex, r);
        curFbo = result.curFbo;
        curTex = result.curTex;
        otherFbo = result.otherFbo;
        otherTex = result.otherTex;
      }
      this.gooseBindFBO(null);
      this.gooseCopy(curTex);
    },
    // gooseSDFUniforms — 为 SDF 程序设置 uniform（canvasSize + offset + size + cornerRadii）
    gooseSDFUniforms(u, aPosLoc, r, cornerRadius) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(u["uCanvasSize"], this.canvas.width, this.canvas.height);
      gl.uniform2f(u["uOffset"], r.x * this.dpr, r.y * this.dpr);
      gl.uniform2f(u["uSize"], r.w * this.dpr, r.h * this.dpr);
      gl.uniform4f(
        u["uCornerRadii"],
        cornerRadius * this.dpr,
        cornerRadius * this.dpr,
        cornerRadius * this.dpr,
        cornerRadius * this.dpr
      );
    },
    // gooseRenderBG — 将壁纸或纯色背景渲染到 fboA 中
    gooseRenderBG() {
      const gl = this.gl;
      this.gooseBindFBO(this.fboA);
      gl.disable(gl.BLEND);
      if (this.backgroundColor) {
        const [r, g, b] = this.backgroundColor;
        this.gooseFill(r, g, b, 1);
      } else {
        gl.useProgram(this.wallpaperProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocWp);
        gl.vertexAttribPointer(this.aPosLocWp, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
        gl.uniform1i(this.uWp["uBackdrop"], 0);
        gl.uniform2f(this.uWp["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uWp["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    },
    // gooseRenderDlg — 将 wallpaper+scrim+colorControls 作为不透明层渲染到 dialogBackdropFbo。
    // 顺序：wallpaper（不透明）→ scrim（glBlendFuncSeparate 正确 alpha）→ colorControls（全屏 pass）。按 scrim+cc 参数缓存。
    // 对话框卡片对此 FBO 进行 2-pass 模糊后再执行镜头折射。
    gooseRenderDlg(scrim, brightness, contrast, saturation) {
      const key = `${scrim.join(",")}|${brightness},${contrast},${saturation}`;
      if (this.dialogBackdropKey === key) return;
      this.dialogBackdropKey = key;
      const gl = this.gl;
      this.gooseBindFBO(this.dialogBackdropFbo);
      gl.disable(gl.BLEND);
      if (this.backgroundColor) {
        const [r, g, b] = this.backgroundColor;
        this.gooseFill(r, g, b, 1);
      } else {
        gl.useProgram(this.wallpaperProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocWp);
        gl.vertexAttribPointer(this.aPosLocWp, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
        gl.uniform1i(this.uWp["uBackdrop"], 0);
        gl.uniform2f(this.uWp["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uWp["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (scrim[3] > 1e-3) {
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this.gooseFill(scrim[0], scrim[1], scrim[2], scrim[3]);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      this.gooseBindFBO(this.blurFboA);
      this.gooseColorCtrl(this.dialogBackdropTex, brightness, contrast, saturation);
      this.gooseBindFBO(this.dialogBackdropFbo);
      this.gooseCopy(this.blurFboATex);
    },
    // gooseRenderPlain — 渲染非玻璃元素（plain-rect / progressive-blur / text）。已处理返回 true（调用方 continue），玻璃元素返回 false（走 ping-pong）。
    gooseRenderPlain(el, r, st, curFbo) {
      var _a, _b, _c, _d;
      const gl = this.gl;
      let r2 = r;
      if (el.enterProgress != null) {
        const raw = el.enterProgress;
        const derived = raw < 0 ? (1 - Math.exp(-Math.abs(raw))) * -1 : raw <= 1 ? raw : 1 + (1 - Math.exp(-(raw - 1)));
        const ty = -48 * gooseDP * (1 - derived);
        const stretch = el.enterStretchFactor != null && derived > 1 ? el.enterStretchFactor * (derived - 1) * 32 * gooseDP : 0;
        r2 = { x: r.x, y: r.y + ty + stretch, w: r.w, h: r.h };
      }
      if (el.kind === "plain-rect" && el.plainRect) {
        const baseC = el.isToggleTrack ? null : el.plainRect.color;
        if (baseC && baseC[3] <= 0) return true;
        this.gooseBindFBO(curFbo);
        let c;
        if (el.isToggleTrack) {
          const tg = this.toggleStates.get(el.isToggleTrack.groupId);
          const f = tg ? tg.fraction : 0;
          const off = el.isToggleTrack.offColor;
          const on = el.isToggleTrack.onColor;
          c = [
            off[0] + (on[0] - off[0]) * f,
            off[1] + (on[1] - off[1]) * f,
            off[2] + (on[2] - off[2]) * f,
            off[3] + (on[3] - off[3]) * f
          ];
        } else {
          c = el.plainRect.color;
        }
        let fillRect = r2;
        if (el.isSliderFill) {
          const sf = this.toggleStates.get(el.isSliderFill.groupId);
          const fraction = sf ? sf.fraction : 0;
          const fillW = Math.max(el.isSliderFill.minW, el.isSliderFill.trackW * fraction);
          fillRect = { x: r.x, y: r.y, w: fillW, h: r.h };
        }
        gl.useProgram(this.plainRectProgram);
        this.gooseSDFUniforms(this.uPr, this.aPosLocPr, fillRect, el.cornerRadius);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const enterA = el.enterProgress != null ? (() => {
          const sp = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress));
          return easeIn(sp);
        })() : 1;
        gl.uniform4f(this.uPr["uColor"], c[0], c[1], c[2], c[3] * enterA);
        gl.uniform1f(this.uPr["uCornerStyle"], this.cornerStyle);
        if (el.useContinuousSdf && this.continuousSdfTexture) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
          gl.uniform1i(this.uPr["uContinuousSdf"], 2);
          gl.uniform1f(this.uPr["uUseContinuousSdf"], 1);
          gl.uniform2f(this.uPr["uContinuousSdfTexSize"], this.continuousSdfTexSize[0], this.continuousSdfTexSize[1]);
          gl.uniform2f(this.uPr["uContinuousSdfElementSize"], r2.w * this.dpr, r2.h * this.dpr);
        } else {
          gl.uniform1f(this.uPr["uUseContinuousSdf"], 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return true;
      }
      if (el.kind === "progressive-blur" && el.progressiveBlur) {
        this.gooseBindFBO(curFbo);
        gl.useProgram(this.progressiveBlurProgram);
        this.gooseSDFUniforms(this.uPb, this.aPosLocPb, r2, el.cornerRadius);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
        gl.uniform1i(this.uPb["uBackdrop"], 0);
        gl.uniform2f(this.uPb["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
        gl.uniform1f(this.uPb["uBlurRadius"], el.progressiveBlur.blurRadius * this.dpr);
        const tc = el.progressiveBlur.tintColor;
        gl.uniform4f(this.uPb["uTintColor"], tc[0], tc[1], tc[2], tc[3]);
        gl.uniform1f(this.uPb["uTintIntensity"], el.progressiveBlur.tintIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return true;
      }
      if (el.kind === "text") {
        this.gooseBindFBO(curFbo);
        let drawRect = r2;
        let fgScaleX = 1;
        let fgScaleY = 1;
        if (el.isBottomTabContent) {
          const tg = this.toggleStates.get(el.isBottomTabContent.groupId);
          if (tg) {
            const containerW = (_a = el.isBottomTabContent.containerWidth) != null ? _a : el.rect.w * 4;
            const containerScale = 1 + 16 * gooseDP / containerW * tg.pressProgress;
            fgScaleX = containerScale;
            fgScaleY = containerScale;
            const pivotX = (_b = el.isBottomTabContent.containerCenterX) != null ? _b : el.rect.x + el.rect.w / 2;
            const pivotY = (_c = el.isBottomTabContent.containerCenterY) != null ? _c : el.rect.y + el.rect.h / 2;
            const tabCenterX = el.rect.x + el.rect.w / 2;
            const tabCenterY = el.rect.y + el.rect.h / 2;
            const cx = pivotX + (tabCenterX - pivotX) * containerScale + tg.panelOffset;
            const cy = pivotY + (tabCenterY - pivotY) * containerScale;
            const sw = el.rect.w * fgScaleX;
            const sh = el.rect.h * fgScaleY;
            drawRect = { x: cx - sw / 2, y: cy - sh / 2, w: sw, h: sh };
          }
        }
        const pText = (_d = st == null ? void 0 : st.pressProgress) != null ? _d : 0;
        if (el.isInteractive && pText > 1e-3) {
          const pressTint = el.pressTintColor;
          gl.useProgram(this.tintProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocTn);
          gl.vertexAttribPointer(this.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
          if (pressTint) {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          } else {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          }
          gl.uniform2f(this.uTn["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(this.uTn["uOffset"], drawRect.x * this.dpr, drawRect.y * this.dpr);
          gl.uniform2f(this.uTn["uSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
          gl.uniform4f(this.uTn["uCornerRadii"], 0, 0, 0, 0);
          gl.uniform2f(this.uTn["uOriginalSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
          gl.uniform1f(this.uTn["uOriginalCornerRadius"], 0);
          gl.uniform2f(this.uTn["uLayerScale"], 1, 1);
          if (pressTint) {
            gl.uniform4f(this.uTn["uColor"], pressTint[0], pressTint[1], pressTint[2], 0.1 * pText);
          } else {
            gl.uniform4f(this.uTn["uColor"], 1, 1, 1, 0.1 * pText);
          }
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        const fgTex = this.fgTextures.get(el.id);
        if (fgTex) {
          gl.useProgram(this.foregroundProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocFg);
          gl.vertexAttribPointer(this.aPosLocFg, 2, gl.FLOAT, false, 0, 0);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fgTex);
          gl.uniform1i(this.uFg["uTexture"], 0);
          gl.uniform2f(this.uFg["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(this.uFg["uOffset"], drawRect.x * this.dpr, drawRect.y * this.dpr);
          gl.uniform2f(this.uFg["uSize"], drawRect.w * this.dpr, drawRect.h * this.dpr);
          gl.uniform4f(
            this.uFg["uCornerRadii"],
            el.cornerRadius * this.dpr,
            el.cornerRadius * this.dpr,
            el.cornerRadius * this.dpr,
            el.cornerRadius * this.dpr
          );
          gl.uniform2f(this.uFg["uOriginalSize"], el.rect.w * this.dpr, el.rect.h * this.dpr);
          gl.uniform1f(this.uFg["uOriginalCornerRadius"], el.cornerRadius * this.dpr);
          gl.uniform2f(this.uFg["uLayerScale"], fgScaleX, fgScaleY);
          gl.uniform1f(this.uFg["uCornerStyle"], this.cornerStyle);
          gl.uniform1f(this.uFg["uAlpha"], el.enterProgress != null ? (() => {
            const sp = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress));
            return easeIn(sp);
          })() : 1);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        return true;
      }
      return false;
    }
  };

  // renderer/methods-render-glass.ts
  var glassRenderMethods = {
    // gooseRenderGlass — FBO ping-pong 渲染玻璃元素（button / glass-shape）。返回交换后的 curFbo/curTex/otherFbo/otherTex 供调用方继续迭代。
    gooseRenderGlass(el, st, curFbo, curTex, otherFbo, otherTex, r) {
      var _a, _b, _c, _d;
      const gl = this.gl;
      const isButton = el.kind === "button";
      const p = (_a = st == null ? void 0 : st.pressProgress) != null ? _a : 0;
      const PRESS_SCALE_RATIO = 4 / 48;
      let scale = 1;
      let translationX = 0;
      let translationY = 0;
      let scaleX = 1;
      let scaleY = 1;
      if (el.enterProgress != null) {
        const raw = el.enterProgress;
        const derived = raw < 0 ? (1 - Math.exp(-Math.abs(raw))) * -1 : raw <= 1 ? raw : 1 + (1 - Math.exp(-(raw - 1)));
        translationY += -48 * gooseDP * (1 - derived);
        if (el.enterStretchFactor != null && derived > 1) {
          translationY += el.enterStretchFactor * (derived - 1) * 32 * gooseDP;
        }
        const sFactor = 1 + 0.1 * Math.max(0, derived - 1);
        scaleX /= sFactor;
        scaleY *= sFactor;
      }
      if (isButton && el.isInteractive && st) {
        const width = el.rect.w;
        const height = el.rect.h;
        const maxDim = Math.max(width, height);
        const minDim = Math.min(width, height);
        const maxOffset = minDim;
        const initialDerivative = 0.05;
        const maxDragScale = PRESS_SCALE_RATIO;
        scale = 1 + PRESS_SCALE_RATIO * p;
        const dx = st.dragX - st.startDragX;
        const dy = st.dragY - st.startDragY;
        translationX = maxOffset * Math.tanh(initialDerivative * dx / maxOffset);
        translationY = maxOffset * Math.tanh(initialDerivative * dy / maxOffset);
        const offsetAngle = Math.atan2(dy, dx);
        const whCap = Math.min(width / height, 1);
        const hwCap = Math.min(height / width, 1);
        scaleX = scale + maxDragScale * Math.abs(Math.cos(offsetAngle) * dx / maxDim) * whCap;
        scaleY = scale + maxDragScale * Math.abs(Math.sin(offsetAngle) * dy / maxDim) * hwCap;
      } else if (el.enterProgress == null) {
        scaleX = scale;
        scaleY = scale;
      }
      let toggleXOffset = 0;
      let toggleScaleX = 1;
      let toggleScaleY = 1;
      let togglePressProgress = 0;
      if (el.isToggleKnob) {
        const tg = this.toggleStates.get(el.isToggleKnob.groupId);
        if (tg) {
          toggleXOffset = tg.fraction * el.isToggleKnob.dragWidth;
          toggleScaleX = tg.scaleX;
          toggleScaleY = tg.scaleY;
          togglePressProgress = tg.pressProgress;
          const divisor = (_b = el.isToggleKnob.velocityDivisor) != null ? _b : 50;
          const vel = tg.velocity / divisor;
          const velX = Math.max(-0.2, Math.min(0.2, vel * 0.75));
          const velY = Math.max(-0.2, Math.min(0.2, vel * 0.25));
          toggleScaleX = toggleScaleX / (1 - velX);
          toggleScaleY = toggleScaleY * (1 - velY);
        }
      }
      scaleX *= toggleScaleX;
      scaleY *= toggleScaleY;
      if (el.isBottomTabContainer) {
        const tg = this.toggleStates.get(el.isBottomTabContainer.groupId);
        if (tg) {
          const containerScale = 1 + 16 * gooseDP / el.rect.w * tg.pressProgress;
          scaleX *= containerScale;
          scaleY *= containerScale;
          translationX += tg.panelOffset;
          togglePressProgress = tg.pressProgress;
        }
      }
      if (el.isBottomTabContent) {
        const tg = this.toggleStates.get(el.isBottomTabContent.groupId);
        if (tg) {
          const containerW = (_c = el.isBottomTabContent.containerWidth) != null ? _c : el.rect.w;
          const containerScale = 1 + 16 * gooseDP / containerW * tg.pressProgress;
          scaleX *= containerScale;
          const contentScale = 1 + 0.2 * tg.pressProgress;
          scaleX *= contentScale;
          scaleY *= containerScale * contentScale;
          translationX += tg.panelOffset;
        }
      }
      if (el.isBottomTabIndicator) {
        const tg = this.toggleStates.get(el.isBottomTabIndicator.groupId);
        if (tg) {
          toggleXOffset += tg.fraction * el.isBottomTabIndicator.dragWidth;
          toggleXOffset += tg.panelOffset;
          const indScaleX = tg.scaleX;
          const indScaleY = tg.scaleY;
          const vel = tg.velocity / 10;
          const velX = Math.max(-0.2, Math.min(0.2, vel * 0.75));
          const velY = Math.max(-0.2, Math.min(0.2, vel * 0.25));
          const finalIndScaleX = indScaleX / (1 - velX);
          const finalIndScaleY = indScaleY * (1 - velY);
          scaleX *= finalIndScaleX;
          scaleY *= finalIndScaleY;
          togglePressProgress = Math.max(togglePressProgress, tg.pressProgress);
        }
      }
      let cx, cy;
      cx = r.x + el.rect.w / 2 + translationX + toggleXOffset;
      cy = r.y + el.rect.h / 2 + translationY;
      const sw = el.rect.w * scaleX;
      const sh = el.rect.h * scaleY;
      const sx = cx - sw / 2;
      const sy = cy - sh / 2;
      const cornerRadius = el.cornerRadius * Math.min(scaleX, scaleY);
      const radii = [
        cornerRadius,
        cornerRadius,
        cornerRadius,
        cornerRadius
      ];
      this.gooseBindFBO(otherFbo);
      this.gooseCopy(curTex);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const MARGIN_CSS = 60;
      const scissorX = Math.max(0, Math.round((sx - MARGIN_CSS) * this.dpr));
      const scissorY = Math.max(0, Math.round((this.cssHeight - (sy + sh + MARGIN_CSS)) * this.dpr));
      const scissorW = Math.min(this.fboW - scissorX, Math.round((sw + 2 * MARGIN_CSS) * this.dpr));
      const scissorH = Math.min(this.fboH - scissorY, Math.round((sh + 2 * MARGIN_CSS) * this.dpr));
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(scissorX, scissorY, scissorW, scissorH);
      const state = {
        el,
        st,
        isButton,
        p,
        sx,
        sy,
        sw,
        sh,
        radii,
        togglePressProgress,
        // toggle 旋钮 + 底部 tab 指示器：高光 alpha 由 pressProgress 调制，静止时应为 0
        //（gooseGlassPass 在 progress>0 时覆盖为 alpha*progress）。非 toggle 元素使用静态 alpha。
        elHighlightAlpha: el.isToggleKnob || el.isBottomTabIndicator ? 0 : el.highlight ? el.highlight.alpha : 0,
        enterAlpha: el.enterProgress != null ? (() => {
          const sp = el.enterSafeProgress != null ? Math.max(0, Math.min(1, el.enterSafeProgress)) : Math.max(0, Math.min(1, el.enterProgress));
          return easeIn(sp);
        })() : 1,
        layerScaleX: scaleX,
        layerScaleY: scaleY,
        layerScale: Math.min(scaleX, scaleY),
        // 元素 pass SDF 使用的原始几何（未缩放）：着色器在原始空间计算 SDF/折射，
        // 再通过 uLayerScale 将折射偏移映射到屏幕空间。
        origW: el.rect.w,
        origH: el.rect.h,
        origCornerRadius: el.cornerRadius,
        elementRotation: (_d = el.elementRotation) != null ? _d : 0
      };
      this.gooseGlassShadow(state);
      if (el.useSeparableBlur && el.blurRadius >= 0.5) {
        const blurRadiusPx = el.blurRadius * state.layerScale * this.dpr;
        const backdropSrc = el.backdropFbo && this.dialogBackdropTex ? this.dialogBackdropTex : curTex;
        const blurredBackdrop = this.gooseBlur(backdropSrc, blurRadiusPx);
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        this.gooseBindFBO(otherFbo);
        this.gl.viewport(0, 0, this.fboW, this.fboH);
        const passState = el.backdropFbo ? { ...state, el: { ...el, backdropFbo: false } } : state;
        this.gooseGlassPass(passState, blurredBackdrop);
      } else {
        this.gooseGlassPass(state, curTex);
      }
      this.gooseGlassPost(state);
      gl.disable(gl.SCISSOR_TEST);
      return {
        curFbo: otherFbo,
        curTex: otherTex,
        otherFbo: curFbo,
        otherTex: curTex
      };
    },
    gooseGlassShadow(state) {
      const gl = this.gl;
      const { el, sx, sy, sw, sh, radii } = state;
      if (!el.outerShadow || el.outerShadow.alpha <= 1e-3 || el.outerShadow.radius <= 0.5) return;
      let shadowAlpha = el.outerShadow.alpha;
      if (el.isBottomTabIndicator) {
        shadowAlpha = el.outerShadow.alpha * state.togglePressProgress;
        if (shadowAlpha <= 1e-3) return;
      }
      gl.useProgram(this.shadowProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.aPosLocSh);
      gl.vertexAttribPointer(this.aPosLocSh, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(this.uSh["uCanvasSize"], this.canvas.width, this.canvas.height);
      gl.uniform2f(this.uSh["uElementOffset"], sx * this.dpr, sy * this.dpr);
      gl.uniform2f(this.uSh["uElementSize"], sw * this.dpr, sh * this.dpr);
      gl.uniform4f(
        this.uSh["uCornerRadii"],
        radii[0] * this.dpr,
        radii[1] * this.dpr,
        radii[2] * this.dpr,
        radii[3] * this.dpr
      );
      gl.uniform2f(this.uSh["uOriginalSize"], state.origW * this.dpr, state.origH * this.dpr);
      gl.uniform1f(this.uSh["uOriginalCornerRadius"], state.origCornerRadius * this.dpr);
      gl.uniform2f(this.uSh["uLayerScale"], state.layerScaleX, state.layerScaleY);
      gl.uniform1f(this.uSh["uElementRotation"], state.elementRotation);
      gl.uniform1f(this.uSh["uCornerStyle"], this.cornerStyle);
      gl.uniform1f(this.uSh["uShadowRadius"], el.outerShadow.radius * this.dpr);
      gl.uniform2f(
        this.uSh["uShadowOffset"],
        el.outerShadow.offsetX * this.dpr,
        el.outerShadow.offsetY * this.dpr
      );
      gl.uniform4f(
        this.uSh["uShadowColor"],
        el.outerShadow.color[0],
        el.outerShadow.color[1],
        el.outerShadow.color[2],
        shadowAlpha
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  };

  // renderer/methods-render-glass-element-pass.ts
  var glassElementPassMethods = {
    // gooseGlassPass — 步骤 2b：元素 pass（折射 + vibrancy + tint + 高光）。
    // 采样 curTex（已构建场景）计算玻璃后方实际颜色（轨道/卡片/其他玻璃元素）的折射，而非仅壁纸。
    gooseGlassPass(state, curTex) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J, _K, _L, _M;
      const gl = this.gl;
      const { el, sx, sy, sw, sh, radii, togglePressProgress, layerScale } = state;
      gl.useProgram(this.elementProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(this.aPosLocEl);
      gl.vertexAttribPointer(this.aPosLocEl, 2, gl.FLOAT, false, 0, 0);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, curTex);
      gl.uniform1i(this.uEl["uBackdrop"], 0);
      if (this.wallpaperTexture) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTexture);
        gl.uniform1i(this.uEl["uWallpaperSampler"], 1);
      }
      gl.uniform2f(this.uEl["uCanvasSize"], this.canvas.width, this.canvas.height);
      gl.uniform2f(this.uEl["uWallpaperSize"], this.wallpaperSize[0], this.wallpaperSize[1]);
      gl.uniform2f(this.uEl["uElementOffset"], sx * this.dpr, sy * this.dpr);
      gl.uniform2f(this.uEl["uElementSize"], sw * this.dpr, sh * this.dpr);
      gl.uniform4f(
        this.uEl["uCornerRadii"],
        radii[0] * this.dpr,
        radii[1] * this.dpr,
        radii[2] * this.dpr,
        radii[3] * this.dpr
      );
      gl.uniform2f(this.uEl["uOriginalSize"], state.origW * this.dpr, state.origH * this.dpr);
      gl.uniform1f(this.uEl["uOriginalCornerRadius"], state.origCornerRadius * this.dpr);
      gl.uniform2f(this.uEl["uLayerScale"], state.layerScaleX, state.layerScaleY);
      gl.uniform1f(this.uEl["uElementRotation"], (_a = el.elementRotation) != null ? _a : 0);
      let elRefractionHeight = el.refractionHeight;
      let elRefractionAmount = el.refractionAmount;
      let elBlurRadius = el.blurRadius;
      let elHighlightAlpha = el.highlight ? el.highlight.alpha : 0;
      let elInnerShadowAlpha = el.innerShadow ? el.innerShadow.alpha : 0;
      let elInnerShadowRadius = el.innerShadow ? el.innerShadow.radius : 0;
      let elInnerShadowOffsetX = el.innerShadow ? el.innerShadow.offsetX : 0;
      let elInnerShadowOffsetY = el.innerShadow ? el.innerShadow.offsetY : 0;
      let elSurfaceAlpha = el.surfaceColor[3];
      if (el.isBottomTabIndicator) {
        const progress = togglePressProgress;
        elRefractionHeight = el.refractionHeight * progress;
        elRefractionAmount = el.refractionAmount * progress;
        elBlurRadius = 0;
        elHighlightAlpha = ((_c = (_b = el.highlight) == null ? void 0 : _b.alpha) != null ? _c : 0) * progress;
        elInnerShadowAlpha = ((_e = (_d = el.innerShadow) == null ? void 0 : _d.alpha) != null ? _e : 0) * progress;
        elInnerShadowRadius = ((_g = (_f = el.innerShadow) == null ? void 0 : _f.radius) != null ? _g : 0) * progress;
        elInnerShadowOffsetX = ((_i = (_h = el.innerShadow) == null ? void 0 : _h.offsetX) != null ? _i : 0) * progress;
        elInnerShadowOffsetY = ((_k = (_j = el.innerShadow) == null ? void 0 : _j.offsetY) != null ? _k : 0) * progress;
      }
      let elContentScaleX = 1;
      let elContentScaleY = 1;
      let useToggleBackdrop = 0;
      let useSolidBackdrop = 0;
      let solidR = 1, solidG = 1, solidB = 1, solidA = 1;
      let trackColorR = 0, trackColorG = 0, trackColorB = 0, trackColorA = 0;
      let trackCenterX = 0, trackCenterY = 0, trackHalfW = 0, trackHalfH = 0;
      let trackCornerRadius = 0;
      if (el.isToggleKnob) {
        const progress = togglePressProgress;
        elRefractionHeight = el.refractionHeight * progress;
        elRefractionAmount = el.refractionAmount * progress;
        elBlurRadius = 8 * (1 - progress);
        elHighlightAlpha = ((_m = (_l = el.highlight) == null ? void 0 : _l.alpha) != null ? _m : 0) * progress;
        elInnerShadowAlpha = ((_o = (_n = el.innerShadow) == null ? void 0 : _n.alpha) != null ? _o : 0) * progress;
        elInnerShadowRadius = ((_q = (_p = el.innerShadow) == null ? void 0 : _p.radius) != null ? _q : 0) * progress;
        elInnerShadowOffsetX = ((_s = (_r = el.innerShadow) == null ? void 0 : _r.offsetX) != null ? _s : 0) * progress;
        elInnerShadowOffsetY = ((_u = (_t = el.innerShadow) == null ? void 0 : _t.offsetY) != null ? _u : 0) * progress;
        elSurfaceAlpha = 0;
        const isSlider = el.isToggleKnob.velocityDivisor === 10;
        const xEnd = isSlider ? 1 : 0.75;
        const yEnd = isSlider ? 1 : 0.75;
        elContentScaleX = 2 / 3 + (xEnd - 2 / 3) * progress;
        elContentScaleY = 0 + (yEnd - 0) * progress;
        if (el.isToggleKnob.trackColorOff && el.isToggleKnob.trackColorOn && el.isToggleKnob.trackW && el.isToggleKnob.trackH) {
          const tg = this.toggleStates.get(el.isToggleKnob.groupId);
          const fraction = tg ? tg.fraction : 0;
          const off = el.isToggleKnob.trackColorOff;
          const on = el.isToggleKnob.trackColorOn;
          trackColorR = off[0] + (on[0] - off[0]) * fraction;
          trackColorG = off[1] + (on[1] - off[1]) * fraction;
          trackColorB = off[2] + (on[2] - off[2]) * fraction;
          trackColorA = off[3] + (on[3] - off[3]) * fraction;
          const knobCenterX = (sx + sw / 2) * this.dpr;
          const knobCenterY = (sy + sh / 2) * this.dpr;
          const trackOrigX = (_v = el.isToggleKnob.trackOriginalX) != null ? _v : el.rect.x;
          const trackOrigY = (_w = el.isToggleKnob.trackOriginalY) != null ? _w : el.rect.y;
          const trackOrigCenterX = (trackOrigX + el.isToggleKnob.trackW / 2) * this.dpr;
          const trackOrigCenterY = (trackOrigY + el.isToggleKnob.trackH / 2) * this.dpr;
          const trackScaleX = 2 / 3 + (xEnd - 2 / 3) * progress;
          const trackScaleY = 0 + (yEnd - 0) * progress;
          trackCenterX = knobCenterX + (trackOrigCenterX - knobCenterX) * trackScaleX;
          trackCenterY = knobCenterY + (trackOrigCenterY - knobCenterY) * trackScaleY;
          const trackW = el.isToggleKnob.trackW * this.dpr;
          const trackH = el.isToggleKnob.trackH * this.dpr;
          trackHalfW = trackW * trackScaleX * 0.5;
          trackHalfH = trackH * trackScaleY * 0.5;
          trackCornerRadius = trackH * 0.5 * Math.min(trackScaleX, trackScaleY);
          useToggleBackdrop = 1;
          if (el.isToggleKnob.solidBackdropColor) {
            const sd = el.isToggleKnob.solidBackdropColor;
            solidR = sd[0];
            solidG = sd[1];
            solidB = sd[2];
            solidA = sd[3];
            useSolidBackdrop = 1;
          }
          elContentScaleX = 1;
          elContentScaleY = 1;
        }
      }
      let useIndicatorBackdrop = 0;
      let containerRectX = 0, containerRectY = 0, containerHalfW = 0, containerHalfH = 0;
      let containerCornerRadius = 0;
      let indicatorAccentR = 0, indicatorAccentG = 0, indicatorAccentB = 0, indicatorAccentA = 0;
      if (el.isBottomTabIndicator) {
        const progress = togglePressProgress;
        elRefractionHeight = el.refractionHeight * progress;
        elRefractionAmount = el.refractionAmount * progress;
        elHighlightAlpha = ((_y = (_x = el.highlight) == null ? void 0 : _x.alpha) != null ? _y : 0) * progress;
        elInnerShadowAlpha = ((_A = (_z = el.innerShadow) == null ? void 0 : _z.alpha) != null ? _A : 0) * progress;
        elInnerShadowRadius = ((_C = (_B = el.innerShadow) == null ? void 0 : _B.radius) != null ? _C : 0) * progress;
        elInnerShadowOffsetX = ((_E = (_D = el.innerShadow) == null ? void 0 : _D.offsetX) != null ? _E : 0) * progress;
        elInnerShadowOffsetY = ((_G = (_F = el.innerShadow) == null ? void 0 : _F.offsetY) != null ? _G : 0) * progress;
        if (el.isBottomTabIndicator.accentColor && el.isBottomTabIndicator.containerRect) {
          const ac = el.isBottomTabIndicator.accentColor;
          const cr = el.isBottomTabIndicator.containerRect;
          indicatorAccentR = ac[0];
          indicatorAccentG = ac[1];
          indicatorAccentB = ac[2];
          indicatorAccentA = 1;
          containerRectX = (cr.x + cr.w / 2) * this.dpr;
          containerRectY = (cr.y + cr.h / 2) * this.dpr;
          containerHalfW = cr.w / 2 * this.dpr;
          containerHalfH = cr.h / 2 * this.dpr;
          containerCornerRadius = cr.h / 2 * this.dpr;
          useIndicatorBackdrop = 1;
        }
      }
      gl.uniform1f(this.uEl["uUseToggleBackdrop"], useToggleBackdrop);
      gl.uniform1f(this.uEl["uUseSolidBackdrop"], useSolidBackdrop);
      gl.uniform4f(this.uEl["uSolidBackdropColor"], solidR, solidG, solidB, solidA);
      gl.uniform4f(this.uEl["uTrackColor"], trackColorR, trackColorG, trackColorB, trackColorA);
      gl.uniform4f(this.uEl["uTrackRect"], trackCenterX, trackCenterY, trackHalfW, trackHalfH);
      gl.uniform1f(this.uEl["uTrackCornerRadius"], trackCornerRadius);
      gl.uniform1f(this.uEl["uIndicatorBackdrop"], useIndicatorBackdrop);
      gl.uniform4f(this.uEl["uContainerRect"], containerRectX, containerRectY, containerHalfW, containerHalfH);
      gl.uniform1f(this.uEl["uContainerCornerRadius"], containerCornerRadius);
      gl.uniform4f(this.uEl["uIndicatorAccent"], indicatorAccentR, indicatorAccentG, indicatorAccentB, indicatorAccentA);
      gl.uniform1f(this.uEl["uInsetPx"], 4 * this.dpr);
      if (el.isBottomTabIndicator) {
        const tg = this.toggleStates.get(el.isBottomTabIndicator.groupId);
        gl.uniform1f(this.uEl["uIndicatorPressProgress"], tg ? tg.pressProgress : 0);
        gl.uniform1f(this.uEl["uIndicatorPanelOffset"], tg ? tg.panelOffset * this.dpr : 0);
        gl.uniform1f(this.uEl["uDpr"], this.dpr);
        const ccx = (_H = el.isBottomTabIndicator.containerCenterX) != null ? _H : 0;
        const ccy = (_I = el.isBottomTabIndicator.containerCenterY) != null ? _I : 0;
        const cw = (_J = el.isBottomTabIndicator.containerWidth) != null ? _J : el.rect.w;
        const cScale = tg ? 1 + 16 * gooseDP / cw * tg.pressProgress : 1;
        gl.uniform2f(this.uEl["uContainerCenter"], ccx * this.dpr, ccy * this.dpr);
        gl.uniform1f(this.uEl["uContainerScale"], cScale);
        const ids = (_K = el.isBottomTabIndicator.tabContentIds) != null ? _K : [];
        const rects = (_L = el.isBottomTabIndicator.tabContentRects) != null ? _L : [];
        const n = Math.min(ids.length, rects.length, 8);
        let boundCount = 0;
        for (let i = 0; i < 8; i++) {
          if (i < n) {
            const tex = this.fgTextures.get(ids[i]);
            if (tex) {
              gl.activeTexture(gl.TEXTURE3 + boundCount);
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.uniform1i(this.uEl[`uTabContentTex${boundCount}`], 3 + boundCount);
              const r = rects[i];
              gl.uniform4f(
                this.uEl[`uTabContentRects[${boundCount}]`],
                (r.x + r.w / 2) * this.dpr,
                (r.y + r.h / 2) * this.dpr,
                r.w / 2 * this.dpr,
                r.h / 2 * this.dpr
              );
              boundCount++;
            }
          }
        }
        for (let i = boundCount; i < 8; i++) {
          gl.uniform4f(this.uEl[`uTabContentRects[${i}]`], 0, 0, 0, 0);
        }
        gl.uniform1f(this.uEl["uTabContentCount"], boundCount);
        if (this.tabsBackdropTex) {
          gl.activeTexture(gl.TEXTURE11);
          gl.bindTexture(gl.TEXTURE_2D, this.tabsBackdropTex);
          gl.uniform1i(this.uEl["uTabsGlassLayer"], 11);
        }
      } else {
        gl.uniform1f(this.uEl["uIndicatorPressProgress"], 0);
        gl.uniform1f(this.uEl["uIndicatorPanelOffset"], 0);
        gl.uniform1f(this.uEl["uDpr"], this.dpr);
        gl.uniform2f(this.uEl["uContainerCenter"], 0, 0);
        gl.uniform1f(this.uEl["uContainerScale"], 1);
        gl.uniform1f(this.uEl["uTabContentCount"], 0);
      }
      gl.uniform1f(this.uEl["uRefractionHeight"], elRefractionHeight * this.dpr);
      gl.uniform1f(this.uEl["uRefractionAmount"], elRefractionAmount * this.dpr);
      gl.uniform1f(this.uEl["uDepthEffect"], el.depthEffect ? 1 : 0);
      gl.uniform1f(this.uEl["uChromaticAberration"], el.chromaticAberration ? 1 : 0);
      const inlineBlurRadius = el.useSeparableBlur && el.blurRadius >= 0.5 ? 0 : elBlurRadius;
      gl.uniform1f(this.uEl["uBlurRadius"], inlineBlurRadius * layerScale * this.dpr);
      gl.uniform1f(this.uEl["uSaturation"], el.saturation);
      gl.uniform1f(this.uEl["uBrightness"], el.brightness);
      gl.uniform1f(this.uEl["uContrast"], el.contrast);
      gl.uniform1f(this.uEl["uContentScaleX"], elContentScaleX);
      gl.uniform1f(this.uEl["uContentScaleY"], elContentScaleY);
      gl.uniform4f(this.uEl["uTintColor"], el.tintColor[0], el.tintColor[1], el.tintColor[2], el.tintColor[3]);
      gl.uniform4f(this.uEl["uSurfaceColor"], el.surfaceColor[0], el.surfaceColor[1], el.surfaceColor[2], elSurfaceAlpha);
      if (el.highlight) {
        gl.uniform3f(this.uEl["uHighlightColor"], el.highlight.color[0], el.highlight.color[1], el.highlight.color[2]);
        gl.uniform1f(this.uEl["uHighlightAngle"], el.highlight.angle);
        gl.uniform1f(this.uEl["uHighlightFalloff"], el.highlight.falloff);
        gl.uniform1f(this.uEl["uHighlightAlpha"], elHighlightAlpha);
        gl.uniform1f(this.uEl["uHighlightMode"], el.highlight.mode);
        const elMinDimPx = Math.min(state.origW, state.origH) * this.dpr;
        const elWidthPx = Math.min(el.highlight.widthDp * this.dpr, elMinDimPx * 0.5);
        const elBlurPx = ((_M = el.highlight.blurRadiusDp) != null ? _M : el.highlight.widthDp / 2) * this.dpr;
        gl.uniform1f(this.uEl["uHighlightStrokeWidth"], Math.ceil(elWidthPx) * 2);
        gl.uniform1f(this.uEl["uHighlightBlur"], elBlurPx);
      } else {
        gl.uniform1f(this.uEl["uHighlightAlpha"], 0);
        gl.uniform1f(this.uEl["uHighlightMode"], 0);
        gl.uniform1f(this.uEl["uHighlightStrokeWidth"], 0);
        gl.uniform1f(this.uEl["uHighlightBlur"], 0);
      }
      if (elInnerShadowAlpha > 1e-3 && elInnerShadowRadius > 0.5) {
        gl.uniform1f(this.uEl["uInnerShadowRadius"], elInnerShadowRadius * this.dpr);
        gl.uniform1f(this.uEl["uInnerShadowAlpha"], elInnerShadowAlpha);
        gl.uniform2f(
          this.uEl["uInnerShadowOffset"],
          elInnerShadowOffsetX * this.dpr,
          elInnerShadowOffsetY * this.dpr
        );
      } else {
        gl.uniform1f(this.uEl["uInnerShadowRadius"], 0);
        gl.uniform1f(this.uEl["uInnerShadowAlpha"], 0);
        gl.uniform2f(this.uEl["uInnerShadowOffset"], 0, 0);
      }
      if (el.isSdfTexture && this.sdfTexture) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.sdfTexture);
        gl.uniform1i(this.uEl["uSdfTexSampler"], 2);
        gl.uniform1f(this.uEl["uUseSdfTexture"], 1);
        gl.uniform2f(this.uEl["uSdfTexSize"], this.sdfTextureSize[0], this.sdfTextureSize[1]);
        gl.uniform1f(this.uEl["uSdfLightAngle"], el.isSdfTexture.lightAngle);
        gl.uniform1f(this.uEl["uRefractionHeight"], el.isSdfTexture.refractionHeight * this.dpr);
      } else {
        gl.uniform1f(this.uEl["uUseSdfTexture"], 0);
      }
      if (el.useContinuousSdf && this.continuousSdfTexture) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
        gl.uniform1i(this.uEl["uContinuousSdf"], 2);
        gl.uniform1f(this.uEl["uUseContinuousSdf"], 1);
        gl.uniform2f(this.uEl["uContinuousSdfTexSize"], this.continuousSdfTexSize[0], this.continuousSdfTexSize[1]);
        gl.uniform2f(this.uEl["uContinuousSdfElementSize"], state.origW * this.dpr, state.origH * this.dpr);
      } else {
        gl.uniform1f(this.uEl["uUseContinuousSdf"], 0);
      }
      gl.uniform1f(this.uEl["uEnterAlpha"], state.enterAlpha);
      gl.uniform1f(this.uEl["uCornerStyle"], this.cornerStyle);
      if (el.isMagnifier) {
        gl.uniform1f(this.uEl["uUseMagnifier"], 1);
        gl.uniform1f(this.uEl["uMagnifierZoom"], el.isMagnifier.zoom);
        gl.uniform1f(this.uEl["uMagnifierOffsetY"], el.isMagnifier.sampleOffsetY * this.dpr);
      } else {
        gl.uniform1f(this.uEl["uUseMagnifier"], 0);
      }
      gl.uniform1f(this.uEl["uSkipColorControls"], el.backdropFbo && el.useSeparableBlur && el.blurRadius >= 0.5 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      state.elHighlightAlpha = elHighlightAlpha;
    }
  };

  // renderer/methods-render-glass-post-passes.ts
  var glassPostPassMethods = {
    // gooseGlassPost — 步骤 2c–2f：按压辉光、白色叠加层、前景、边缘高光，合成在玻璃主体之上。
    gooseGlassPost(state) {
      var _a, _b;
      const gl = this.gl;
      const { el, st, isButton, p, sx, sy, sw, sh, radii, togglePressProgress, elHighlightAlpha } = state;
      const origSizeX = state.origW * this.dpr;
      const origSizeY = state.origH * this.dpr;
      const origRadius = state.origCornerRadius * this.dpr;
      const layerScaleX = state.layerScaleX;
      const layerScaleY = state.layerScaleY;
      const isContainer = !!el.isBottomTabContainer;
      const glowP = isButton ? p : isContainer ? togglePressProgress : 0;
      if (isButton && el.isInteractive && st && p > 1e-3 || isContainer && togglePressProgress > 1e-3) {
        gl.useProgram(this.tintProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocTn);
        gl.vertexAttribPointer(this.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.uniform2f(this.uTn["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uTn["uOffset"], sx * this.dpr, sy * this.dpr);
        gl.uniform2f(this.uTn["uSize"], sw * this.dpr, sh * this.dpr);
        gl.uniform4f(
          this.uTn["uCornerRadii"],
          radii[0] * this.dpr,
          radii[1] * this.dpr,
          radii[2] * this.dpr,
          radii[3] * this.dpr
        );
        gl.uniform2f(this.uTn["uOriginalSize"], origSizeX, origSizeY);
        gl.uniform1f(this.uTn["uOriginalCornerRadius"], origRadius);
        gl.uniform2f(this.uTn["uLayerScale"], layerScaleX, layerScaleY);
        gl.uniform1f(this.uTn["uElementRotation"], state.elementRotation);
        gl.uniform1f(this.uTn["uCornerStyle"], this.cornerStyle);
        gl.uniform4f(this.uTn["uColor"], 1, 1, 1, 0.08 * glowP);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.useProgram(this.highlightProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocHl);
        gl.vertexAttribPointer(this.aPosLocHl, 2, gl.FLOAT, false, 0, 0);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.uniform2f(this.uHl["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uHl["uOffset"], sx * this.dpr, sy * this.dpr);
        gl.uniform2f(this.uHl["uSize"], sw * this.dpr, sh * this.dpr);
        gl.uniform4f(
          this.uHl["uCornerRadii"],
          radii[0] * this.dpr,
          radii[1] * this.dpr,
          radii[2] * this.dpr,
          radii[3] * this.dpr
        );
        gl.uniform2f(this.uHl["uOriginalSize"], origSizeX, origSizeY);
        gl.uniform1f(this.uHl["uOriginalCornerRadius"], origRadius);
        gl.uniform2f(this.uHl["uLayerScale"], layerScaleX, layerScaleY);
        gl.uniform1f(this.uHl["uElementRotation"], state.elementRotation);
        gl.uniform1f(this.uHl["uCornerStyle"], this.cornerStyle);
        gl.uniform4f(this.uHl["uColor"], 1, 1, 1, 0.15 * glowP);
        const minDim = Math.min(sw, sh) * this.dpr;
        gl.uniform1f(this.uHl["uRadius"], minDim * 1.5);
        let px, py;
        if (isContainer) {
          const tg = this.toggleStates.get(el.isBottomTabContainer.groupId);
          const tabsCount = (_a = el.isBottomTabContainer.tabsCount) != null ? _a : 4;
          const tabW = el.rect.w / tabsCount;
          const fraction = tg ? tg.fraction : 0;
          const indCenterX = (fraction + 0.5) * tabW;
          const scaleToLocal = sw / el.rect.w;
          px = Math.max(0, Math.min(sw, indCenterX * scaleToLocal)) * this.dpr;
          py = sh / 2 * this.dpr;
        } else {
          px = Math.max(0, Math.min(sw, st.dragX * state.layerScaleX)) * this.dpr;
          py = Math.max(0, Math.min(sh, st.dragY * state.layerScaleY)) * this.dpr;
        }
        gl.uniform2f(this.uHl["uPosition"], px, py);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      if (el.isToggleKnob && togglePressProgress < 0.999) {
        const whiteAlpha = 1 * (1 - togglePressProgress);
        gl.useProgram(this.tintProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocTn);
        gl.vertexAttribPointer(this.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform2f(this.uTn["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uTn["uOffset"], sx * this.dpr, sy * this.dpr);
        gl.uniform2f(this.uTn["uSize"], sw * this.dpr, sh * this.dpr);
        gl.uniform4f(
          this.uTn["uCornerRadii"],
          radii[0] * this.dpr,
          radii[1] * this.dpr,
          radii[2] * this.dpr,
          radii[3] * this.dpr
        );
        gl.uniform2f(this.uTn["uOriginalSize"], origSizeX, origSizeY);
        gl.uniform1f(this.uTn["uOriginalCornerRadius"], origRadius);
        gl.uniform2f(this.uTn["uLayerScale"], layerScaleX, layerScaleY);
        gl.uniform1f(this.uTn["uElementRotation"], state.elementRotation);
        gl.uniform1f(this.uTn["uCornerStyle"], this.cornerStyle);
        gl.uniform4f(this.uTn["uColor"], 1, 1, 1, whiteAlpha);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.dimColor) {
        const dc = el.isBottomTabIndicator.dimColor;
        const p2 = togglePressProgress;
        gl.useProgram(this.tintProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.aPosLocTn);
        gl.vertexAttribPointer(this.aPosLocTn, 2, gl.FLOAT, false, 0, 0);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.uniform2f(this.uTn["uCanvasSize"], this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uTn["uOffset"], sx * this.dpr, sy * this.dpr);
        gl.uniform2f(this.uTn["uSize"], sw * this.dpr, sh * this.dpr);
        gl.uniform4f(this.uTn["uCornerRadii"], radii[0] * this.dpr, radii[1] * this.dpr, radii[2] * this.dpr, radii[3] * this.dpr);
        gl.uniform2f(this.uTn["uOriginalSize"], origSizeX, origSizeY);
        gl.uniform1f(this.uTn["uOriginalCornerRadius"], origRadius);
        gl.uniform2f(this.uTn["uLayerScale"], layerScaleX, layerScaleY);
        gl.uniform1f(this.uTn["uElementRotation"], state.elementRotation);
        gl.uniform1f(this.uTn["uCornerStyle"], this.cornerStyle);
        gl.uniform4f(this.uTn["uColor"], dc[0], dc[1], dc[2], 0.1 * (1 - p2));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.uniform4f(this.uTn["uColor"], 0, 0, 0, 0.03 * p2);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      }
      if (isButton && (el.label || el.icon)) {
        const fgTex = this.fgTextures.get(el.id);
        if (fgTex) {
          gl.useProgram(this.foregroundProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocFg);
          gl.vertexAttribPointer(this.aPosLocFg, 2, gl.FLOAT, false, 0, 0);
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, fgTex);
          gl.uniform1i(this.uFg["uTexture"], 0);
          gl.uniform2f(this.uFg["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(this.uFg["uOffset"], sx * this.dpr, sy * this.dpr);
          gl.uniform2f(this.uFg["uSize"], sw * this.dpr, sh * this.dpr);
          gl.uniform4f(
            this.uFg["uCornerRadii"],
            radii[0] * this.dpr,
            radii[1] * this.dpr,
            radii[2] * this.dpr,
            radii[3] * this.dpr
          );
          gl.uniform2f(this.uFg["uOriginalSize"], origSizeX, origSizeY);
          gl.uniform1f(this.uFg["uOriginalCornerRadius"], origRadius);
          gl.uniform2f(this.uFg["uLayerScale"], layerScaleX, layerScaleY);
          gl.uniform1f(this.uFg["uCornerStyle"], this.cornerStyle);
          if (el.useContinuousSdf && this.continuousSdfTexture) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, this.continuousSdfTexture);
            gl.uniform1i(this.uFg["uContinuousSdf"], 2);
            gl.uniform1f(this.uFg["uUseContinuousSdf"], 1);
            gl.uniform2f(this.uFg["uContinuousSdfTexSize"], this.continuousSdfTexSize[0], this.continuousSdfTexSize[1]);
            gl.uniform2f(this.uFg["uContinuousSdfElementSize"], state.origW * this.dpr, state.origH * this.dpr);
          } else {
            gl.uniform1f(this.uFg["uUseContinuousSdf"], 0);
          }
          gl.uniform1f(this.uFg["uAlpha"], 1 - 0.15 * p);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      }
      if (el.highlight && el.highlight.alpha > 1e-3) {
        const rimAlpha = el.isToggleKnob || el.isBottomTabIndicator ? elHighlightAlpha : el.highlight.alpha;
        const finalAlpha = rimAlpha * state.enterAlpha;
        if (finalAlpha > 1e-3) {
          const widthPx = Math.min(
            el.highlight.widthDp * this.dpr,
            Math.min(origSizeX, origSizeY) * 0.5
          );
          const strokeWidthDevice = Math.max(1, Math.ceil(widthPx) * 2);
          const blurPx = Math.max(0, ((_b = el.highlight.blurRadiusDp) != null ? _b : el.highlight.widthDp / 2) * this.dpr);
          const strokeMargin = Math.ceil(strokeWidthDevice) + 4;
          const maskW = Math.max(1, Math.ceil(origSizeX + 2 * strokeMargin));
          const maskH = Math.max(1, Math.ceil(origSizeY + 2 * strokeMargin));
          const useG2 = !!el.useContinuousSdf;
          const maskKey = [
            useG2 ? "g2" : "rr",
            origSizeX.toFixed(3),
            origSizeY.toFixed(3),
            origRadius.toFixed(3),
            strokeWidthDevice,
            blurPx.toFixed(3),
            strokeMargin,
            maskW,
            maskH
          ].join(":");
          let mask = this.strokeMaskCache.get(maskKey);
          if (!mask) {
            const canvas = document.createElement("canvas");
            canvas.width = maskW;
            canvas.height = maskH;
            const ctx = canvas.getContext("2d", { alpha: true });
            if (!ctx) throw new Error("2D canvas not supported");
            const tex = gl.createTexture();
            if (!tex) throw new Error("WebGL texture allocation failed");
            mask = { tex, canvas, ctx, w: maskW, h: maskH, ready: false };
            this.strokeMaskCache.set(maskKey, mask);
            if (this.strokeMaskCache.size > 32) {
              const oldestKey = this.strokeMaskCache.keys().next().value;
              if (oldestKey && oldestKey !== maskKey) {
                const oldest = this.strokeMaskCache.get(oldestKey);
                if (oldest) gl.deleteTexture(oldest.tex);
                this.strokeMaskCache.delete(oldestKey);
              }
            }
          }
          if (!mask.ready) {
            const smCtx = mask.ctx;
            smCtx.clearRect(0, 0, mask.w, mask.h);
            smCtx.save();
            smCtx.translate(strokeMargin, strokeMargin);
            let path;
            if (useG2) {
              path = continuousCurvatureRoundedRectPath(smCtx, origSizeX, origSizeY, origRadius);
            } else {
              path = new Path2D();
              const r = Math.min(origRadius, origSizeX / 2, origSizeY / 2);
              path.moveTo(r, 0);
              path.lineTo(origSizeX - r, 0);
              path.arcTo(origSizeX, 0, origSizeX, r, r);
              path.lineTo(origSizeX, origSizeY - r);
              path.arcTo(origSizeX, origSizeY, origSizeX - r, origSizeY, r);
              path.lineTo(r, origSizeY);
              path.arcTo(0, origSizeY, 0, origSizeY - r, r);
              path.lineTo(0, r);
              path.arcTo(0, 0, r, 0, r);
              path.closePath();
            }
            smCtx.clip(path);
            smCtx.lineWidth = strokeWidthDevice;
            smCtx.strokeStyle = "rgba(255,255,255,1)";
            smCtx.lineJoin = "round";
            smCtx.lineCap = "round";
            smCtx.filter = blurPx > 0.01 ? `blur(${blurPx}px)` : "none";
            smCtx.stroke(path);
            smCtx.filter = "none";
            smCtx.restore();
            gl.bindTexture(gl.TEXTURE_2D, mask.tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            mask.ready = true;
          }
          gl.enable(gl.BLEND);
          if (el.highlight.mode === 1) {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          } else {
            gl.blendFunc(gl.ONE, gl.ONE);
          }
          gl.useProgram(this.strokeMaskCompositeProgram);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
          gl.enableVertexAttribArray(this.aPosLocSm);
          gl.vertexAttribPointer(this.aPosLocSm, 2, gl.FLOAT, false, 0, 0);
          gl.uniform2f(this.uSm["uCanvasSize"], this.canvas.width, this.canvas.height);
          gl.uniform2f(this.uSm["uOffset"], sx * this.dpr, sy * this.dpr);
          gl.uniform2f(this.uSm["uSize"], sw * this.dpr, sh * this.dpr);
          gl.uniform4f(this.uSm["uCornerRadii"], radii[0] * this.dpr, radii[1] * this.dpr, radii[2] * this.dpr, radii[3] * this.dpr);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, mask.tex);
          gl.uniform1i(this.uSm["uStrokeMask"], 0);
          gl.uniform2f(this.uSm["uMaskOffset"], strokeMargin, strokeMargin);
          gl.uniform2f(this.uSm["uMaskSize"], mask.w, mask.h);
          gl.uniform4f(this.uSm["uHighlightColor"], el.highlight.color[0], el.highlight.color[1], el.highlight.color[2], 1);
          gl.uniform1f(this.uSm["uHighlightAngle"], el.useGravityAngle ? this.gravityAngle : el.highlight.angle);
          gl.uniform1f(this.uSm["uHighlightFalloff"], el.highlight.falloff);
          gl.uniform1f(this.uSm["uHighlightAlpha"], finalAlpha);
          gl.uniform1f(this.uSm["uHighlightMode"], el.highlight.mode);
          gl.uniform2f(this.uSm["uOriginalSize"], origSizeX, origSizeY);
          gl.uniform1f(this.uSm["uOriginalCornerRadius"], origRadius);
          gl.uniform2f(this.uSm["uLayerScale"], layerScaleX, layerScaleY);
          gl.uniform1f(this.uSm["uElementRotation"], state.elementRotation);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      }
    }
  };

  // renderer/index.ts
  var LiquidGlassRenderer = class {
    constructor(canvas) {
      __publicField(this, "gl");
      __publicField(this, "elementProgram");
      __publicField(this, "shadowProgram");
      __publicField(this, "wallpaperProgram");
      __publicField(this, "foregroundProgram");
      __publicField(this, "highlightProgram");
      __publicField(this, "tintProgram");
      __publicField(this, "rimHighlightProgram");
      /** Pass 1：描边蒙版（裁剪+硬描边）。 */
      __publicField(this, "highlightStrokeProgram");
      /** Pass 3：合成（模糊蒙版×强度×颜色）。 */
      __publicField(this, "highlightCompositeProgram");
      /** 描边蒙版合成（Canvas2D 描边蒙版×强度×颜色）。 */
      __publicField(this, "strokeMaskCompositeProgram");
      __publicField(this, "plainRectProgram");
      __publicField(this, "progressiveBlurProgram");
      __publicField(this, "copyProgram");
      __publicField(this, "solidFillProgram");
      __publicField(this, "colorControlsProgram");
      __publicField(this, "sceneTintProgram");
      __publicField(this, "quadBuffer");
      __publicField(this, "wallpaperTexture", null);
      __publicField(this, "wallpaperReady", false);
      __publicField(this, "wallpaperSize", [1, 1]);
      __publicField(this, "canvas");
      __publicField(this, "dpr", 0);
      // 0 = 尚未设置；gooseResize() 在首次调用时设置默认上限
      __publicField(this, "buttonConfigs", []);
      __publicField(this, "buttonStates", /* @__PURE__ */ new Map());
      /** 切换组状态 — 以 groupId 为键。 */
      __publicField(this, "toggleStates", /* @__PURE__ */ new Map());
      __publicField(this, "scrollY", 0);
      __publicField(this, "scrollVelocity", 0);
      __publicField(this, "contentHeight", 0);
      __publicField(this, "cssWidth", 0);
      __publicField(this, "cssHeight", 0);
      __publicField(this, "wheelTarget", null);
      __publicField(this, "backgroundColor", null);
      /** 脏标记 — 状态变化时置 true，gooseRender() 据此跳过冗余重绘。 */
      __publicField(this, "needsRedraw", true);
      // 场景 FBO ping-pong 基础设施（详见 gooseRender()）
      __publicField(this, "fboA", null);
      __publicField(this, "fboATex", null);
      __publicField(this, "fboB", null);
      __publicField(this, "fboBTex", null);
      __publicField(this, "fboW", 0);
      __publicField(this, "fboH", 0);
      // tabsBackdrop FBO：指示器的隐藏着色层（LiquidBottomTabs.kt 的 rememberCombinedBackdrop）。
      // 将已绘容器+标签场景渲染到此 FBO，做 accent 着色后供指示器作为第二背景层采样。
      __publicField(this, "tabsBackdropFbo", null);
      __publicField(this, "tabsBackdropTex", null);
      __publicField(this, "tabsBackdropDirty", true);
      // 可分离 2-pass 模糊基础设施（仅 Glass Playground 使用）。
      // gpElementFbo：元素折射通道（CLEAR 背景，uBlurRadius=0）。
      // blurFboA/blurFboB：2-pass 高斯（H→V）的 ping-pong，结果 alpha 合成回场景。
      __publicField(this, "gpElementFbo", null);
      __publicField(this, "gpElementTex", null);
      __publicField(this, "blurFboA", null);
      __publicField(this, "blurFboATex", null);
      __publicField(this, "blurFboB", null);
      __publicField(this, "blurFboBTex", null);
      // 高亮蒙版 FBO（3-pass 高亮）：
      // Pass 1：HIGHLIGHT_STROKE_FRAGMENT_SHADER 渲染裁剪描边 alpha 蒙版。
      // Pass 2：gooseBlur(mask, sigma) → blurFboB（2-pass 高斯，对应 Skia BlurMaskFilter NORMAL）。
      // Pass 3：HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER 采样 blurFboB，乘以 intensity+color 混合入场景。
      __publicField(this, "highlightMaskFbo", null);
      __publicField(this, "highlightMaskTex", null);
      // 对话框背景 FBO：wallpaper+scrim+colorControls 合并为不透明层，
      // 供 backdropFbo=true + useSeparableBlur 的对话框卡片做 2-pass 模糊采样。
      __publicField(this, "dialogBackdropFbo", null);
      __publicField(this, "dialogBackdropTex", null);
      /** dialogBackdropFbo 的缓存键（scrim+cc 参数） — 若未变化则跳过 re-gooseRender。 */
      __publicField(this, "dialogBackdropKey", null);
      /** 按 1D tap 数量键控的模糊着色器变体（各有 H+V 程序）。 */
      __publicField(this, "blurPrograms", /* @__PURE__ */ new Map());
      /** 高亮模糊程序 — 模糊 ALPHA 蒙版，使用 Android BlurMaskFilter sigma 语义（uRadius=sigma），支持亚像素 sigma。 */
      __publicField(this, "highlightBlurPrograms", /* @__PURE__ */ new Map());
      /** 玻璃高亮方向重力角度（弧度），由 gooseGravAngle 实时更新，默认 45°=0.785rad。 */
      __publicField(this, "gravityAngle", 45 * Math.PI / 180);
      /** 每次模糊 pass 的最大 1D tap 数（1..33），默认 17。越低越快，越高画质越好。 */
      __publicField(this, "blurTapCap", 17);
      /** 模糊降采样系数（1=全分辨率，2=半，4=四分之一）。越高越快但画质略低。 */
      __publicField(this, "blurDownsample", 1);
      /** 圆角样式：0=圆形，1=连续（squircle）。默认 1。 */
      __publicField(this, "cornerStyle", 1);
      // 用于锁屏玻璃的 SDF 纹理（clock_sdf）
      __publicField(this, "sdfTexture", null);
      __publicField(this, "sdfTextureReady", false);
      __publicField(this, "sdfTextureSize", [1, 1]);
      // 连续曲率蒙版纹理池：每个唯一 (w,h,radius,dpr) 一份纹理，当前绑定的在 continuousSdfTexture。
      __publicField(this, "continuousSdfPool", /* @__PURE__ */ new Map());
      __publicField(this, "continuousSdfTexture", null);
      __publicField(this, "continuousSdfTexSize", [256, 256]);
      __publicField(this, "continuousSdfKey", null);
      // 前景离屏 2D canvas（标签+雪佛龙箭头），跨按钮复用，每帧重新光栅化并上传。
      __publicField(this, "fgCanvas");
      __publicField(this, "fgCtx");
      __publicField(this, "fgTextures", /* @__PURE__ */ new Map());
      __publicField(this, "fgDirtyIds", /* @__PURE__ */ new Set());
      // 边缘高亮的 Canvas2D 描边蒙版缓存。按精确几何（尺寸+圆角+描边宽度+dpr 路径样式）键控，
      // 与角度/alpha/按压进度无关，可跨帧复用，无分辨率上限或 UV 不匹配问题。
      __publicField(this, "strokeMaskCache", /* @__PURE__ */ new Map());
      __publicField(this, "rafId", null);
      __publicField(this, "animRafId", null);
      __publicField(this, "aPosLocEl");
      __publicField(this, "aPosLocSh");
      __publicField(this, "aPosLocWp");
      __publicField(this, "aPosLocFg");
      __publicField(this, "aPosLocHl");
      __publicField(this, "aPosLocTn");
      __publicField(this, "aPosLocRm");
      __publicField(this, "aPosLocHs");
      // 高亮描边
      __publicField(this, "aPosLocHc");
      // 高亮合成
      __publicField(this, "aPosLocSm");
      // 描边蒙版合成
      __publicField(this, "aPosLocPr");
      __publicField(this, "aPosLocPb");
      __publicField(this, "aPosLocCp");
      __publicField(this, "aPosLocSf");
      __publicField(this, "aPosLocCc");
      __publicField(this, "aPosLocSt");
      // 程序 uniform 位置（已缓存）
      __publicField(this, "uEl", {});
      __publicField(this, "uSh", {});
      __publicField(this, "uWp", {});
      __publicField(this, "uFg", {});
      __publicField(this, "uHl", {});
      __publicField(this, "uTn", {});
      __publicField(this, "uRm", {});
      __publicField(this, "uHs", {});
      __publicField(this, "uHc", {});
      __publicField(this, "uSm", {});
      __publicField(this, "uPr", {});
      __publicField(this, "uPb", {});
      __publicField(this, "uCp", {});
      __publicField(this, "uSf", {});
      __publicField(this, "uCc", {});
      __publicField(this, "uSt", {});
      var _a;
      this.canvas = canvas;
      const gl = canvas.getContext("webgl", {
        premultipliedAlpha: false,
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false
      });
      if (!gl) throw new Error("WebGL not supported");
      this.gl = gl;
      this.elementProgram = createProgram(gl, VERTEX_SHADER, ELEMENT_FRAGMENT_SHADER);
      this.shadowProgram = createProgram(gl, VERTEX_SHADER, SHADOW_FRAGMENT_SHADER);
      this.wallpaperProgram = createProgram(gl, VERTEX_SHADER, WALLPAPER_FRAGMENT_SHADER);
      this.foregroundProgram = createProgram(gl, VERTEX_SHADER, FOREGROUND_FRAGMENT_SHADER);
      this.highlightProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_FRAGMENT_SHADER);
      this.tintProgram = createProgram(gl, VERTEX_SHADER, TINT_FRAGMENT_SHADER);
      this.rimHighlightProgram = createProgram(gl, VERTEX_SHADER, RIM_HIGHLIGHT_FRAGMENT_SHADER);
      this.highlightStrokeProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_STROKE_FRAGMENT_SHADER);
      this.highlightCompositeProgram = createProgram(gl, VERTEX_SHADER, HIGHLIGHT_COMPOSITE_FRAGMENT_SHADER);
      this.strokeMaskCompositeProgram = createProgram(gl, VERTEX_SHADER, STROKE_MASK_COMPOSITE_FRAGMENT_SHADER);
      this.plainRectProgram = createProgram(gl, VERTEX_SHADER, PLAIN_RECT_FRAGMENT_SHADER);
      this.progressiveBlurProgram = createProgram(gl, VERTEX_SHADER, PROGRESSIVE_BLUR_FRAGMENT_SHADER);
      this.copyProgram = createProgram(gl, VERTEX_SHADER, COPY_FRAGMENT_SHADER);
      this.solidFillProgram = createProgram(gl, VERTEX_SHADER, SOLID_FILL_FRAGMENT_SHADER);
      this.colorControlsProgram = createProgram(gl, VERTEX_SHADER, COLOR_CONTROLS_FRAGMENT_SHADER);
      this.sceneTintProgram = createProgram(gl, VERTEX_SHADER, SCENE_TINT_FRAGMENT_SHADER);
      this.quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      this.aPosLocEl = gl.getAttribLocation(this.elementProgram, "aPos");
      this.aPosLocSh = gl.getAttribLocation(this.shadowProgram, "aPos");
      this.aPosLocWp = gl.getAttribLocation(this.wallpaperProgram, "aPos");
      this.aPosLocFg = gl.getAttribLocation(this.foregroundProgram, "aPos");
      this.aPosLocHl = gl.getAttribLocation(this.highlightProgram, "aPos");
      this.aPosLocTn = gl.getAttribLocation(this.tintProgram, "aPos");
      this.aPosLocRm = gl.getAttribLocation(this.rimHighlightProgram, "aPos");
      this.aPosLocHs = gl.getAttribLocation(this.highlightStrokeProgram, "aPos");
      this.aPosLocHc = gl.getAttribLocation(this.highlightCompositeProgram, "aPos");
      this.aPosLocSm = gl.getAttribLocation(this.strokeMaskCompositeProgram, "aPos");
      this.aPosLocPr = gl.getAttribLocation(this.plainRectProgram, "aPos");
      this.aPosLocPb = gl.getAttribLocation(this.progressiveBlurProgram, "aPos");
      this.aPosLocCp = gl.getAttribLocation(this.copyProgram, "aPos");
      this.aPosLocSf = gl.getAttribLocation(this.solidFillProgram, "aPos");
      this.aPosLocCc = gl.getAttribLocation(this.colorControlsProgram, "aPos");
      this.aPosLocSt = gl.getAttribLocation(this.sceneTintProgram, "aPos");
      this.fgCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
      const fgCtx = (_a = this.fgCanvas) == null ? void 0 : _a.getContext("2d", { alpha: true });
      if (!fgCtx) throw new Error("2D canvas not supported");
      this.fgCtx = fgCtx;
      this.gooseUniforms();
    }
    gooseUniforms() {
      const gl = this.gl;
      const elNames = [
        "uBackdrop",
        "uWallpaperSampler",
        "uTabsBackdropSampler",
        "uCanvasSize",
        "uWallpaperSize",
        "uElementOffset",
        "uElementSize",
        "uCornerRadii",
        "uRefractionHeight",
        "uRefractionAmount",
        "uDepthEffect",
        "uChromaticAberration",
        "uBlurRadius",
        "uSaturation",
        "uBrightness",
        "uContrast",
        "uTintColor",
        "uSurfaceColor",
        "uHighlightColor",
        "uHighlightAngle",
        "uHighlightFalloff",
        "uHighlightAlpha",
        "uHighlightMode",
        "uHighlightStrokeWidth",
        "uHighlightBlur",
        "uInnerShadowRadius",
        "uInnerShadowAlpha",
        "uInnerShadowOffset",
        "uContentScaleX",
        "uContentScaleY",
        "uUseToggleBackdrop",
        "uUseSolidBackdrop",
        "uSolidBackdropColor",
        "uTrackColor",
        "uTrackRect",
        "uTrackCornerRadius",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uIndicatorBackdrop",
        "uContainerRect",
        "uContainerCornerRadius",
        "uIndicatorAccent",
        "uInsetPx",
        "uIndicatorPressProgress",
        "uIndicatorPanelOffset",
        "uDpr",
        "uContainerCenter",
        "uContainerScale",
        "uTabContentTex0",
        "uTabContentTex1",
        "uTabContentTex2",
        "uTabContentTex3",
        "uTabContentTex4",
        "uTabContentTex5",
        "uTabContentTex6",
        "uTabContentTex7",
        "uTabContentRects[0]",
        "uTabContentRects[1]",
        "uTabContentRects[2]",
        "uTabContentRects[3]",
        "uTabContentRects[4]",
        "uTabContentRects[5]",
        "uTabContentRects[6]",
        "uTabContentRects[7]",
        "uTabContentCount",
        "uTabsGlassLayer",
        "uSdfTexSampler",
        "uUseSdfTexture",
        "uSdfTexSize",
        "uSdfLightAngle",
        "uEnterAlpha",
        "uCornerStyle",
        "uSkipColorControls",
        "uUseMagnifier",
        "uMagnifierZoom",
        "uMagnifierOffsetY",
        "uElementRotation",
        "uContinuousSdf",
        "uUseContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of elNames) this.uEl[n] = gl.getUniformLocation(this.elementProgram, n);
      const shNames = [
        "uCanvasSize",
        "uElementOffset",
        "uElementSize",
        "uCornerRadii",
        "uShadowRadius",
        "uShadowOffset",
        "uShadowColor",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle"
      ];
      for (const n of shNames) this.uSh[n] = gl.getUniformLocation(this.shadowProgram, n);
      const wpNames = ["uBackdrop", "uCanvasSize", "uWallpaperSize"];
      for (const n of wpNames) this.uWp[n] = gl.getUniformLocation(this.wallpaperProgram, n);
      const fgNames = [
        "uTexture",
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uAlpha",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uCornerStyle",
        "uUseContinuousSdf",
        "uContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of fgNames) this.uFg[n] = gl.getUniformLocation(this.foregroundProgram, n);
      const hlNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uColor",
        "uRadius",
        "uPosition",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle"
      ];
      for (const n of hlNames) this.uHl[n] = gl.getUniformLocation(this.highlightProgram, n);
      const tnNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uColor",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle"
      ];
      for (const n of tnNames) this.uTn[n] = gl.getUniformLocation(this.tintProgram, n);
      const rmNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uHighlightColor",
        "uHighlightAngle",
        "uHighlightFalloff",
        "uHighlightAlpha",
        "uHighlightMode",
        "uHighlightStrokeWidth",
        "uHighlightBlur",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle",
        "uUseContinuousSdf",
        "uContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of rmNames) this.uRm[n] = gl.getUniformLocation(this.rimHighlightProgram, n);
      const hsNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uHighlightStrokeWidth",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle",
        "uUseContinuousSdf",
        "uContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of hsNames) this.uHs[n] = gl.getUniformLocation(this.highlightStrokeProgram, n);
      const hcNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uBlurredMask",
        "uMaskTexSize",
        "uHighlightColor",
        "uHighlightAngle",
        "uHighlightFalloff",
        "uHighlightAlpha",
        "uHighlightMode",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation",
        "uCornerStyle",
        "uUseContinuousSdf",
        "uContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of hcNames) this.uHc[n] = gl.getUniformLocation(this.highlightCompositeProgram, n);
      const smNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uStrokeMask",
        "uMaskOffset",
        "uMaskSize",
        "uHighlightColor",
        "uHighlightAngle",
        "uHighlightFalloff",
        "uHighlightAlpha",
        "uHighlightMode",
        "uOriginalSize",
        "uOriginalCornerRadius",
        "uLayerScale",
        "uElementRotation"
      ];
      for (const n of smNames) this.uSm[n] = gl.getUniformLocation(this.strokeMaskCompositeProgram, n);
      const prNames = [
        "uCanvasSize",
        "uOffset",
        "uSize",
        "uCornerRadii",
        "uColor",
        "uCornerStyle",
        "uUseContinuousSdf",
        "uContinuousSdf",
        "uContinuousSdfTexSize",
        "uContinuousSdfElementSize"
      ];
      for (const n of prNames) this.uPr[n] = gl.getUniformLocation(this.plainRectProgram, n);
      const pbNames = [
        "uBackdrop",
        "uCanvasSize",
        "uWallpaperSize",
        "uOffset",
        "uSize",
        "uBlurRadius",
        "uTintColor",
        "uTintIntensity"
      ];
      for (const n of pbNames) this.uPb[n] = gl.getUniformLocation(this.progressiveBlurProgram, n);
      const cpNames = ["uTexture", "uCanvasSize"];
      for (const n of cpNames) this.uCp[n] = gl.getUniformLocation(this.copyProgram, n);
      const sfNames = ["uColor"];
      for (const n of sfNames) this.uSf[n] = gl.getUniformLocation(this.solidFillProgram, n);
      const ccNames = ["uTexture", "uTexSize", "uBrightness", "uContrast", "uSaturation"];
      for (const n of ccNames) this.uCc[n] = gl.getUniformLocation(this.colorControlsProgram, n);
      const stNames = ["uTexture", "uCanvasSize", "uTintColor"];
      for (const n of stNames) this.uSt[n] = gl.getUniformLocation(this.sceneTintProgram, n);
    }
    /** 为指定 1D tap 数量延迟编译水平 + 垂直模糊程序。 */
    gooseBlurProg(tapCount) {
      if (this.blurPrograms.has(tapCount)) return;
      const gl = this.gl;
      const hFs = compileShader(gl, gl.FRAGMENT_SHADER, generateSeparableBlurShader(tapCount, "horizontal"));
      const vFs = compileShader(gl, gl.FRAGMENT_SHADER, generateSeparableBlurShader(tapCount, "vertical"));
      const mk = (fs) => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          const log = gl.getProgramInfoLog(p);
          gl.deleteProgram(p);
          throw new Error("Blur program link error (taps=" + tapCount + "): " + log);
        }
        return p;
      };
      const hProg = mk(hFs);
      const vProg = mk(vFs);
      const uH = {
        uTexture: gl.getUniformLocation(hProg, "uTexture"),
        uTexSize: gl.getUniformLocation(hProg, "uTexSize"),
        uRadius: gl.getUniformLocation(hProg, "uRadius")
      };
      const uV = {
        uTexture: gl.getUniformLocation(vProg, "uTexture"),
        uTexSize: gl.getUniformLocation(vProg, "uTexSize"),
        uRadius: gl.getUniformLocation(vProg, "uRadius")
      };
      this.blurPrograms.set(tapCount, { hProg, vProg, uH, uV, aPosH: 0, aPosV: 0 });
    }
    /** 对源纹理按 radius 像素做 2-pass 模糊。读 srcTex，写 blurFboB，返回 blurFboBTex；保存/恢复当前 framebuffer。tap 数受 blurTapCap 限制。 */
    gooseBlur(srcTex, radius) {
      const gl = this.gl;
      const w = this.fboW;
      const h = this.fboH;
      let taps = computeBlur1DTapCount(radius);
      taps = Math.min(taps, Math.max(1, this.blurTapCap | 0));
      this.gooseBlurProg(taps);
      const entry = this.blurPrograms.get(taps);
      const savedFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboA);
      gl.viewport(0, 0, w, h);
      gl.useProgram(entry.hProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(entry.aPosH);
      gl.vertexAttribPointer(entry.aPosH, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(entry.uH["uTexture"], 0);
      gl.uniform2f(entry.uH["uTexSize"], w, h);
      gl.uniform1f(entry.uH["uRadius"], radius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboB);
      gl.viewport(0, 0, w, h);
      gl.useProgram(entry.vProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(entry.aPosV);
      gl.vertexAttribPointer(entry.aPosV, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurFboATex);
      gl.uniform1i(entry.uV["uTexture"], 0);
      gl.uniform2f(entry.uV["uTexSize"], w, h);
      gl.uniform1f(entry.uV["uRadius"], radius);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, savedFb);
      gl.viewport(0, 0, w, h);
      return this.blurFboBTex;
    }
    /** 延迟编译高亮模糊程序（alpha 模糊，sigma 语义，无提前返回）。 */
    gooseHLBlurProg(tapCount) {
      if (this.highlightBlurPrograms.has(tapCount)) return;
      const gl = this.gl;
      const hFs = compileShader(gl, gl.FRAGMENT_SHADER, generateHighlightBlurShader(tapCount, "horizontal"));
      const vFs = compileShader(gl, gl.FRAGMENT_SHADER, generateHighlightBlurShader(tapCount, "vertical"));
      const mk = (fs) => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, "aPos");
        gl.linkProgram(p);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
          const log = gl.getProgramInfoLog(p);
          gl.deleteProgram(p);
          throw new Error("Highlight blur program link error (taps=" + tapCount + "): " + log);
        }
        return p;
      };
      const hProg = mk(hFs);
      const vProg = mk(vFs);
      const uH = {
        uTexture: gl.getUniformLocation(hProg, "uTexture"),
        uTexSize: gl.getUniformLocation(hProg, "uTexSize"),
        uRadius: gl.getUniformLocation(hProg, "uRadius")
      };
      const uV = {
        uTexture: gl.getUniformLocation(vProg, "uTexture"),
        uTexSize: gl.getUniformLocation(vProg, "uTexSize"),
        uRadius: gl.getUniformLocation(vProg, "uRadius")
      };
      this.highlightBlurPrograms.set(tapCount, { hProg, vProg, uH, uV, aPosH: 0, aPosV: 0 });
    }
    /** 对高亮描边 MASK（仅 alpha）做 2-pass 高斯模糊，对应 Android BlurMaskFilter(NORMAL, sigma)。
     *  sigma=blurRadiusPx，亚像素 sigma（0.25px）仍会模糊（无 0.5 提前返回）。
     *  读 srcTex 写 blurFboB，返回 blurFboBTex；保存/恢复当前 framebuffer。 */
    gooseHLBlur(srcTex, sigmaPx) {
      const gl = this.gl;
      const w = this.fboW;
      const h = this.fboH;
      let taps = computeHighlightBlurTapCount(sigmaPx);
      taps = Math.min(taps, Math.max(3, this.blurTapCap | 0));
      this.gooseHLBlurProg(taps);
      const entry = this.highlightBlurPrograms.get(taps);
      const savedFb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboA);
      gl.viewport(0, 0, w, h);
      gl.useProgram(entry.hProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(entry.aPosH);
      gl.vertexAttribPointer(entry.aPosH, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(entry.uH["uTexture"], 0);
      gl.uniform2f(entry.uH["uTexSize"], w, h);
      gl.uniform1f(entry.uH["uRadius"], sigmaPx);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFboB);
      gl.viewport(0, 0, w, h);
      gl.useProgram(entry.vProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      gl.enableVertexAttribArray(entry.aPosV);
      gl.vertexAttribPointer(entry.aPosV, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blurFboATex);
      gl.uniform1i(entry.uV["uTexture"], 0);
      gl.uniform2f(entry.uV["uTexSize"], w, h);
      gl.uniform1f(entry.uV["uRadius"], sigmaPx);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, savedFb);
      gl.viewport(0, 0, w, h);
      return this.blurFboBTex;
    }
    gooseKill() {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      if (this.animRafId !== null) cancelAnimationFrame(this.animRafId);
      this.animRafId = null;
      const gl = this.gl;
      if (this.wallpaperTexture) gl.deleteTexture(this.wallpaperTexture);
      for (const tex of this.fgTextures.values()) gl.deleteTexture(tex);
      this.fgTextures.clear();
      for (const entry of this.strokeMaskCache.values()) gl.deleteTexture(entry.tex);
      this.strokeMaskCache.clear();
      if (this.fboA) gl.deleteFramebuffer(this.fboA);
      if (this.fboATex) gl.deleteTexture(this.fboATex);
      if (this.fboB) gl.deleteFramebuffer(this.fboB);
      if (this.fboBTex) gl.deleteTexture(this.fboBTex);
      this.fboA = this.fboB = null;
      this.fboATex = this.fboBTex = null;
      if (this.tabsBackdropFbo) gl.deleteFramebuffer(this.tabsBackdropFbo);
      if (this.tabsBackdropTex) gl.deleteTexture(this.tabsBackdropTex);
      this.tabsBackdropFbo = null;
      this.tabsBackdropTex = null;
      if (this.gpElementFbo) gl.deleteFramebuffer(this.gpElementFbo);
      if (this.gpElementTex) gl.deleteTexture(this.gpElementTex);
      if (this.blurFboA) gl.deleteFramebuffer(this.blurFboA);
      if (this.blurFboATex) gl.deleteTexture(this.blurFboATex);
      if (this.blurFboB) gl.deleteFramebuffer(this.blurFboB);
      if (this.blurFboBTex) gl.deleteTexture(this.blurFboBTex);
      this.gpElementFbo = this.blurFboA = this.blurFboB = null;
      this.gpElementTex = this.blurFboATex = this.blurFboBTex = null;
      if (this.highlightMaskFbo) gl.deleteFramebuffer(this.highlightMaskFbo);
      if (this.highlightMaskTex) gl.deleteTexture(this.highlightMaskTex);
      this.highlightMaskFbo = null;
      this.highlightMaskTex = null;
      if (this.dialogBackdropFbo) gl.deleteFramebuffer(this.dialogBackdropFbo);
      if (this.dialogBackdropTex) gl.deleteTexture(this.dialogBackdropTex);
      this.dialogBackdropFbo = null;
      this.dialogBackdropTex = null;
      this.dialogBackdropKey = null;
      for (const { hProg, vProg } of this.blurPrograms.values()) {
        gl.deleteProgram(hProg);
        gl.deleteProgram(vProg);
      }
      this.blurPrograms.clear();
      for (const { hProg, vProg } of this.highlightBlurPrograms.values()) {
        gl.deleteProgram(hProg);
        gl.deleteProgram(vProg);
      }
      this.highlightBlurPrograms.clear();
      if (this.sdfTexture) gl.deleteTexture(this.sdfTexture);
      this.sdfTexture = null;
      for (const { tex } of this.continuousSdfPool.values()) gl.deleteTexture(tex);
      this.continuousSdfPool.clear();
      this.continuousSdfTexture = null;
      this.continuousSdfKey = null;
      gl.deleteProgram(this.elementProgram);
      gl.deleteProgram(this.shadowProgram);
      gl.deleteProgram(this.wallpaperProgram);
      gl.deleteProgram(this.foregroundProgram);
      gl.deleteProgram(this.highlightProgram);
      gl.deleteProgram(this.tintProgram);
      gl.deleteProgram(this.rimHighlightProgram);
      gl.deleteProgram(this.highlightStrokeProgram);
      gl.deleteProgram(this.highlightCompositeProgram);
      gl.deleteProgram(this.strokeMaskCompositeProgram);
      gl.deleteProgram(this.plainRectProgram);
      gl.deleteProgram(this.progressiveBlurProgram);
      gl.deleteProgram(this.copyProgram);
      gl.deleteProgram(this.solidFillProgram);
      gl.deleteProgram(this.colorControlsProgram);
      gl.deleteProgram(this.sceneTintProgram);
      gl.deleteBuffer(this.quadBuffer);
    }
  };
  /** 底部标签指示器的按压缩放比例（Kotlin 中为 78f/56f）。 */
  __publicField(LiquidGlassRenderer, "gooseTabScale", 78 / 56);
  Object.assign(
    LiquidGlassRenderer.prototype,
    fboMethods,
    wallpaperMethods,
    scrollMethods,
    toggleMethods,
    tabsMethods,
    elementMethods,
    animationMethods,
    rasterMethods,
    renderMethods,
    glassRenderMethods,
    glassElementPassMethods,
    glassPostPassMethods
  );

  // catalog/types.ts
  var gooseDP2 = 1;
  var gooseDragGroups = /* @__PURE__ */ new Set();
  var gooseBtnH = 48 * gooseDP2;
  var gooseBtnPad = 16 * gooseDP2;
  var gooseTextSz = 15 * gooseDP2;
  var gooseSubSz = 15 * gooseDP2;
  var gooseTitleSz = 28 * gooseDP2;
  var gooseFont = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  var gooseGlassP = {
    refractionHeight: 12 * gooseDP2,
    refractionAmount: -24 * gooseDP2,
    depthEffect: false,
    chromaticAberration: false,
    blurRadius: 2 * gooseDP2,
    saturation: 1.5,
    brightness: 0,
    contrast: 1
  };
  var gooseHL = {
    mode: 0,
    color: [1, 1, 1],
    angle: 45 * Math.PI / 180,
    falloff: 1,
    alpha: 1,
    widthDp: 0.5
  };
  var gooseShadow = {
    radius: 24 * gooseDP2,
    alpha: 0.1,
    offsetX: 0,
    offsetY: 24 / 6 * gooseDP2,
    color: [0, 0, 0]
  };
  var gooseLight = {
    homeContentColor: [0, 0, 0, 1],
    homeSubtitleColor: [0 / 255, 136 / 255, 255 / 255, 1],
    homeTextHalo: "dark",
    toggleAccent: [52 / 255, 199 / 255, 89 / 255],
    toggleTrackOff: [120 / 255, 120 / 255, 120 / 255, 0.2],
    toggleCardBg: [1, 1, 1, 1],
    sliderAccent: [0 / 255, 136 / 255, 255 / 255],
    sliderTrackOff: [120 / 255, 120 / 255, 120 / 255, 0.2],
    sliderCardBg: [1, 1, 1, 1],
    tabsContentColor: [0, 0, 0, 1],
    tabsAccent: [0 / 255, 136 / 255, 255 / 255],
    tabsContainer: [250 / 255, 250 / 255, 250 / 255, 0.4],
    tabsTextHalo: "dark",
    dialogContentColor: [0, 0, 0, 1],
    dialogAccent: [0 / 255, 136 / 255, 255 / 255, 1],
    dialogContainer: [250 / 255, 250 / 255, 250 / 255, 0.6],
    dialogDim: [41 / 255, 41 / 255, 58 / 255, 0.23],
    dialogBlurRadius: 16 * gooseDP2,
    dialogBrightness: 0.2,
    magnifierContentColor: [0, 0, 0, 1],
    magnifierAccent: [0 / 255, 136 / 255, 255 / 255, 1],
    magnifierCardBg: [1, 1, 1, 0.9],
    controlCenterAccent: [0 / 255, 136 / 255, 255 / 255, 1],
    progressiveContentColor: [0, 0, 0, 1],
    progressiveTint: [1, 1, 1, 1],
    progressiveTextHalo: "dark",
    adaptiveContentColor: [0, 0, 0, 1],
    backIconColor: [0, 0, 0, 1],
    buttonSurface: [1, 1, 1, 0.3]
  };
  var gooseDark = {
    homeContentColor: [1, 1, 1, 1],
    homeSubtitleColor: [0 / 255, 136 / 255, 255 / 255, 1],
    homeTextHalo: "light",
    toggleAccent: [48 / 255, 209 / 255, 88 / 255],
    toggleTrackOff: [120 / 255, 120 / 255, 128 / 255, 0.36],
    toggleCardBg: [18 / 255, 18 / 255, 18 / 255, 1],
    sliderAccent: [0 / 255, 145 / 255, 255 / 255],
    sliderTrackOff: [120 / 255, 120 / 255, 128 / 255, 0.36],
    sliderCardBg: [18 / 255, 18 / 255, 18 / 255, 1],
    tabsContentColor: [1, 1, 1, 1],
    tabsAccent: [0 / 255, 145 / 255, 255 / 255],
    tabsContainer: [18 / 255, 18 / 255, 18 / 255, 0.4],
    tabsTextHalo: "light",
    dialogContentColor: [1, 1, 1, 1],
    dialogAccent: [0 / 255, 145 / 255, 255 / 255, 1],
    dialogContainer: [18 / 255, 18 / 255, 18 / 255, 0.4],
    dialogDim: [18 / 255, 18 / 255, 18 / 255, 0.56],
    dialogBlurRadius: 8 * gooseDP2,
    dialogBrightness: 0,
    magnifierContentColor: [1, 1, 1, 1],
    magnifierAccent: [0 / 255, 145 / 255, 255 / 255, 1],
    magnifierCardBg: [18 / 255, 18 / 255, 18 / 255, 0.9],
    controlCenterAccent: [0 / 255, 145 / 255, 255 / 255, 1],
    progressiveContentColor: [1, 1, 1, 1],
    progressiveTint: [128 / 255, 128 / 255, 128 / 255, 1],
    progressiveTextHalo: "light",
    adaptiveContentColor: [1, 1, 1, 1],
    backIconColor: [1, 1, 1, 1],
    buttonSurface: [18 / 255, 18 / 255, 18 / 255, 0.4]
  };
  function goosePalette(isLightTheme) {
    return isLightTheme ? gooseLight : gooseDark;
  }
  var gooseTglAcc = gooseLight.toggleAccent;
  var gooseTglTrk = gooseLight.toggleTrackOff;
  var gooseSldAcc = gooseLight.sliderAccent;
  var gooseSldTrk = gooseLight.sliderTrackOff;
  var gooseDlgCont = gooseLight.dialogContainer;
  var gooseDlgAcc = gooseLight.dialogAccent;
  var gooseDlgDim = gooseLight.dialogDim;
  var gooseLorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";
  var gooseFlight = "M400 552 L147 653 q-24 10 -45.5 -4.5 T80 608 v-22 q0 -12 5.5 -23 t15.5 -18 l299 -209 v-176 q0 -33 23.5 -56.5 T480 80 q33 0 56.5 23.5 T560 160 v176 l299 209 q10 7 15.5 18 t5.5 23 v22 q0 26 -21.5 40.5 T813 653 L560 552 v144 l103 72 q8 6 12.5 14.5 T680 801 v24 q0 20 -16.5 32.5 T627 864 l-147 -44 l-147 44 q-20 6 -36.5 -6.5 T280 825 v-24 q0 -10 4.5 -18.5 T297 768 l103 -72 v-144 Z";
  var gooseDefState = {
    toggleOn: false,
    sliderValue: 50,
    selectedTab: 0,
    selectedTab2: 0,
    cornerRadiusFrac: 0.5,
    blurRadiusDp: 0,
    refractionHeightFrac: 0.2,
    refractionAmountFrac: 0.2,
    chromaticAberration: 0,
    magnifierX: 0,
    magnifierY: 0,
    lockScreenOffsetX: 0,
    lockScreenOffsetY: 0,
    controlCenterActive: 0,
    controlCenterEnter: 1,
    controlCenterSafeEnter: 1,
    gpSheetExpanded: true,
    gpOffsetX: 0,
    gpOffsetY: 0,
    gpZoom: 1,
    gpRotation: 0,
    algOffsetX: 0,
    algOffsetY: 0,
    adaptiveLuminance: 0.5,
    customDpr: 0,
    globalSeparableBlur: true,
    blurTapCap: 17,
    blurDownsample: 1,
    capsuleShape: true,
    liveDpr: null,
    liveTapCap: null,
    hideOverlayButtons: false,
    ratingValue: 0,
    ringProgressValue: 50
  };
  var _measureCtx = null;
  function gooseTextW(text, fontPx, weight = 400) {
    if (typeof document !== "undefined") {
      if (!_measureCtx) {
        const c = document.createElement("canvas");
        _measureCtx = c.getContext("2d");
      }
      if (_measureCtx) {
        _measureCtx.font = `${weight} ${fontPx}px ${gooseFont}`;
        return _measureCtx.measureText(text).width;
      }
    }
    return text.length * fontPx * 0.55;
  }
  var gooseTrackH = 6 * gooseDP2;
  var gooseKnobW = 40 * gooseDP2;
  var gooseKnobH = 24 * gooseDP2;
  var gooseHitH = 48 * gooseDP2;

  // catalog/helpers.ts
  var dragStates = /* @__PURE__ */ new Map();
  function gooseDrag(opts) {
    const {
      groupId,
      trackX,
      dragW,
      rendererRef,
      onValueChange,
      onLiveValue,
      getFraction,
      beginDrag,
      drag,
      endDrag,
      setTarget,
      count,
      snap,
      liveUpdate = false,
      onTapJump = true,
      didDragThreshold = 3
    } = opts;
    if (!dragStates.has(groupId)) dragStates.set(groupId, { fraction: 0, x: 0, didDrag: false });
    const ds = dragStates.get(groupId);
    const fracFromPos = (px) => Math.max(0, Math.min(1, (px - trackX) / dragW));
    const applySnap = (f) => snap ? snap(f) : f;
    return {
      onTap: (pos) => {
        if (!onTapJump) return;
        const f = applySnap(fracFromPos(pos.x));
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (r) setTarget(r, groupId, f, count);
        onValueChange(f);
      },
      onDragStart: (pos) => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        gooseDragGroups.add(groupId);
        ds.fraction = getFraction(r, groupId);
        ds.x = pos.x;
        ds.didDrag = false;
        beginDrag(r, groupId, ds.fraction, count);
      },
      onDrag: (pos) => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        if (Math.abs(pos.x - ds.x) > didDragThreshold) ds.didDrag = true;
        drag(r, groupId, ds.fraction, pos.x, ds.x, dragW, count);
        const f = getFraction(r, groupId);
        if (onLiveValue) onLiveValue(f);
        if (liveUpdate) {
          onValueChange(f);
        }
      },
      onDragEnd: () => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        const rawF = endDrag(r, groupId, count);
        const snappedF = applySnap(rawF);
        if (snap && count == null) setTarget(r, groupId, snappedF, count);
        onValueChange(snappedF);
        gooseDragGroups.delete(groupId);
      }
    };
  }
  var sliderDragBindings = {
    getFraction: (r, id) => r.gooseTglFrac(id),
    beginDrag: (r, id, f) => r.gooseTglDragStart(id, f),
    drag: (r, id, sf, cx, sx, dw) => r.gooseTglDrag(id, sf, cx, sx, dw),
    endDrag: (r, id) => r.gooseSldDragEnd(id),
    setTarget: (r, id, f) => r.gooseTglTarget(id, f)
  };
  var toggleDragBindings = {
    getFraction: (r, id) => r.gooseTglTargetGet(id),
    beginDrag: (r, id, f) => r.gooseTglDragStart(id, f),
    drag: (r, id, sf, cx, sx, dw) => r.gooseTglDrag(id, sf, cx, sx, dw),
    endDrag: (r, id) => r.gooseTglDragEnd(id),
    setTarget: (r, id, f) => r.gooseTglTarget(id, f)
  };
  function gooseBtn(id, rect, spec, scroll = true) {
    return {
      id,
      kind: "button",
      rect,
      ...gooseGlassP,
      cornerRadius: rect.h / 2,
      tintColor: spec.tintColor,
      surfaceColor: spec.surfaceColor,
      highlight: { ...gooseHL },
      outerShadow: { ...gooseShadow },
      label: spec.label,
      labelColor: spec.labelColor,
      labelFontSizePx: spec.labelFontSizePx,
      showChevron: false,
      isInteractive: true,
      scroll
    };
  }
  function gooseText(id, rect, text, opts = {}, scroll = true) {
    var _a, _b, _c, _d, _e, _f, _g;
    return {
      id,
      kind: "text",
      rect,
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      pressTintColor: opts.pressTintColor,
      scroll,
      text: {
        content: text,
        color: (_a = opts.color) != null ? _a : [0, 0, 0, 1],
        fontSizePx: (_b = opts.fontSizePx) != null ? _b : gooseTextSz,
        fontWeight: (_c = opts.fontWeight) != null ? _c : 400,
        align: (_d = opts.align) != null ? _d : "left",
        wrap: (_e = opts.wrap) != null ? _e : false,
        paddingPx: (_f = opts.paddingPx) != null ? _f : 16,
        valign: opts.valign,
        maxLines: opts.maxLines,
        halo: (_g = opts.halo) != null ? _g : "auto",
        icon: opts.icon
      }
    };
  }
  function gooseRect(id, rect, color, cornerRadius = 0, scroll = true) {
    return {
      id,
      kind: "plain-rect",
      rect,
      cornerRadius,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      scroll,
      plainRect: { color }
    };
  }
  function gooseTabDrag(groupId, tabWidth, tabsCount, onSelect, rendererRef) {
    if (!dragStates.has(groupId)) dragStates.set(groupId, { fraction: 0, x: 0, didDrag: false });
    const ds = dragStates.get(groupId);
    return {
      onTap: () => {
      },
      onDragStart: (pos) => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        gooseDragGroups.add(groupId);
        ds.fraction = r.gooseTabTarget(groupId);
        ds.x = pos.x;
        ds.didDrag = false;
        r.gooseTabDragStart(groupId, ds.fraction, tabsCount);
      },
      onDrag: (pos) => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        if (Math.abs(pos.x - ds.x) > 3) ds.didDrag = true;
        r.gooseTabDrag(groupId, ds.fraction, pos.x, ds.x, tabWidth, tabsCount);
      },
      onDragEnd: () => {
        const r = rendererRef == null ? void 0 : rendererRef.current;
        if (!r) return;
        const finalIndex = r.gooseTabDragEnd(groupId, tabsCount);
        if (ds.didDrag) {
          onSelect(finalIndex);
        }
        gooseDragGroups.delete(groupId);
      }
    };
  }
  function gooseGlass(id, rect, opts = {}, scroll = true) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    return {
      id,
      kind: "glass-shape",
      rect,
      cornerRadius: (_a = opts.cornerRadius) != null ? _a : rect.h / 2,
      refractionHeight: (_b = opts.refractionHeight) != null ? _b : 12 * gooseDP2,
      refractionAmount: (_c = opts.refractionAmount) != null ? _c : -24 * gooseDP2,
      depthEffect: (_d = opts.depthEffect) != null ? _d : false,
      chromaticAberration: (_e = opts.chromaticAberration) != null ? _e : false,
      blurRadius: (_f = opts.blurRadius) != null ? _f : 2 * gooseDP2,
      saturation: (_g = opts.saturation) != null ? _g : 1.5,
      brightness: (_h = opts.brightness) != null ? _h : 0,
      contrast: (_i = opts.contrast) != null ? _i : 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: (_j = opts.surfaceColor) != null ? _j : [0, 0, 0, 0],
      highlight: opts.highlight !== void 0 ? opts.highlight : { ...gooseHL },
      outerShadow: opts.outerShadow !== void 0 ? opts.outerShadow : null,
      label: "",
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      scroll,
      innerShadow: (_k = opts.innerShadow) != null ? _k : null
    };
  }
  var ARROW_BACK_ICON_PATH = "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z";
  var SUN_ICON_PATH = "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 17a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1zM4.22 4.22a1 1 0 0 1 1.41 0l1.42 1.42a1 1 0 1 1-1.42 1.41L4.22 5.63a1 1 0 0 1 0-1.41zm12.73 12.73a1 1 0 0 1 1.41 0l1.42 1.42a1 1 0 1 1-1.42 1.41l-1.41-1.42a1 1 0 0 1 0-1.41zM2 12a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1zm17 0a1 1 0 0 1 1-1h2a1 1 0 1 1 0 2h-2a1 1 0 0 1-1-1zM4.22 19.78a1 1 0 0 1 0-1.41l1.42-1.42a1 1 0 1 1 1.41 1.42l-1.41 1.41a1 1 0 0 1-1.42 0zM16.95 7.05a1 1 0 0 1 0-1.41l1.42-1.42a1 1 0 1 1 1.41 1.42l-1.41 1.41a1 1 0 0 1-1.42 0z";
  var MOON_ICON_PATH = "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z";
  function gooseBack(onBack, palette, scroll = false) {
    const size = 56 * gooseDP2;
    const iconSize = 32 * gooseDP2;
    const element = {
      id: "__back__",
      kind: "button",
      rect: { x: 16, y: 16, w: size, h: size },
      ...gooseGlassP,
      cornerRadius: size / 2,
      // circular
      tintColor: [0, 0, 0, 0],
      surfaceColor: palette.buttonSurface,
      highlight: null,
      // no edge highlight on the back button
      outerShadow: { ...gooseShadow, radius: 12 * gooseDP2, alpha: 0.08 },
      label: "",
      // no text label — icon replaces it
      labelColor: palette.backIconColor,
      showChevron: false,
      isInteractive: true,
      scroll,
      icon: {
        path: ARROW_BACK_ICON_PATH,
        size: iconSize,
        color: palette.backIconColor
      }
    };
    return {
      element,
      interaction: { onTap: () => onBack() }
    };
  }
  function gooseThemeBtn(onToggleTheme, palette, isLightTheme, canvasW, scroll = false) {
    const size = 56 * gooseDP2;
    const iconSize = 32 * gooseDP2;
    const element = {
      id: "__theme__",
      kind: "button",
      rect: { x: canvasW - 16 - size, y: 16, w: size, h: size },
      ...gooseGlassP,
      cornerRadius: size / 2,
      // 圆形
      tintColor: [0, 0, 0, 0],
      surfaceColor: palette.buttonSurface,
      highlight: null,
      // 无边缘高亮（与返回按钮一致）
      outerShadow: { ...gooseShadow, radius: 12 * gooseDP2, alpha: 0.08 },
      label: "",
      labelColor: palette.backIconColor,
      showChevron: false,
      isInteractive: true,
      scroll,
      icon: {
        // 深色模式显示太阳（点击 → 浅色）；浅色模式显示月亮（点击 → 深色）。
        path: isLightTheme ? MOON_ICON_PATH : SUN_ICON_PATH,
        size: iconSize,
        color: palette.backIconColor
      }
    };
    return {
      element,
      interaction: { onTap: () => onToggleTheme() }
    };
  }
  function gooseCenter(elements, contentTop, contentHeight, H) {
    const contentSize = contentHeight - contentTop;
    if (contentSize >= H) return contentHeight;
    const yOffset = Math.max(0, (H - contentSize) / 2 - contentTop);
    if (yOffset <= 0) return contentHeight;
    for (const el of elements) {
      if (el.id === "__back__" || el.id === "__theme__") continue;
      if (el.scroll === false && el.id !== "__pickimage__") continue;
      el.rect = { ...el.rect, y: el.rect.y + yOffset };
      if (el.hitRect) {
        el.hitRect = { ...el.hitRect, y: el.hitRect.y + yOffset };
      }
      if (el.isToggleKnob && el.isToggleKnob.trackOriginalY != null) {
        el.isToggleKnob.trackOriginalY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.containerRect) {
        el.isBottomTabIndicator.containerRect = {
          ...el.isBottomTabIndicator.containerRect,
          y: el.isBottomTabIndicator.containerRect.y + yOffset
        };
      }
      if (el.isBottomTabContent && el.isBottomTabContent.containerCenterY != null) {
        el.isBottomTabContent.containerCenterY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.containerCenterY != null) {
        el.isBottomTabIndicator.containerCenterY += yOffset;
      }
      if (el.isBottomTabIndicator && el.isBottomTabIndicator.tabContentRects) {
        el.isBottomTabIndicator.tabContentRects = el.isBottomTabIndicator.tabContentRects.map((r) => ({
          ...r,
          y: r.y + yOffset
        }));
      }
    }
    return contentHeight + yOffset;
  }

  // catalog/build-buttons.ts
  var BUTTON_STYLES = {
    transparent: { tintColor: [0, 0, 0, 0], surfaceColor: [0, 0, 0, 0], labelColor: [0, 0, 0, 1] },
    surface: { tintColor: [0, 0, 0, 0], surfaceColor: [1, 1, 1, 0.3], labelColor: [0, 0, 0, 1] },
    blue: { tintColor: [0 / 255, 136 / 255, 255 / 255, 1], surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1] },
    orange: { tintColor: [255 / 255, 141 / 255, 40 / 255, 1], surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1] },
    red: { tintColor: [255 / 255, 77 / 255, 79 / 255, 1], surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1] },
    green: { tintColor: [52 / 255, 199 / 255, 75 / 255, 1], surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1] },
    purple: { tintColor: [156 / 255, 39 / 255, 176 / 255, 1], surfaceColor: [0, 0, 0, 0], labelColor: [1, 1, 1, 1] }
  };
  function buildButtons(W, H, onBack, palette, onButtonTap, buttonsConfig) {
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const defaultSpecs = [
      {
        id: "btn-transparent",
        label: "Transparent Liquid Button",
        tintColor: [0, 0, 0, 0],
        surfaceColor: [0, 0, 0, 0],
        labelColor: [0, 0, 0, 1]
      },
      {
        id: "btn-surface",
        label: "Surface Liquid Button",
        tintColor: [0, 0, 0, 0],
        surfaceColor: [1, 1, 1, 0.3],
        labelColor: [0, 0, 0, 1]
      },
      {
        id: "btn-tinted-blue",
        label: "Tinted Liquid Button",
        tintColor: [0 / 255, 136 / 255, 255 / 255, 1],
        surfaceColor: [0, 0, 0, 0],
        labelColor: [1, 1, 1, 1]
      },
      {
        id: "btn-tinted-orange",
        label: "Tinted Liquid Button",
        tintColor: [255 / 255, 141 / 255, 40 / 255, 1],
        surfaceColor: [0, 0, 0, 0],
        labelColor: [1, 1, 1, 1]
      }
    ];
    const configs = buttonsConfig && buttonsConfig.length ? buttonsConfig.map((c, i) => {
      var _a;
      const st = typeof c.style === "string" ? BUTTON_STYLES[c.style] || BUTTON_STYLES.blue : c.style || BUTTON_STYLES.transparent;
      return {
        id: c.id || "btn-" + i,
        label: (_a = c.label) != null ? _a : "\u6309\u94AE " + (i + 1),
        tintColor: st.tintColor,
        surfaceColor: st.surfaceColor,
        labelColor: st.labelColor
      };
    }) : defaultSpecs;
    const spacing = 16 * gooseDP2;
    let cursorY = 0;
    for (const spec of configs) {
      const textW = gooseTextW(spec.label, gooseTextSz);
      const w = Math.ceil(textW + 2 * gooseBtnPad);
      const x = (W - w) / 2;
      const el = gooseBtn(spec.id, { x, y: cursorY, w, h: gooseBtnH }, spec);
      elements.push(el);
      if (onButtonTap) {
        interactions[spec.id] = { onTap: () => onButtonTap(spec.id) };
      }
      cursorY += gooseBtnH + spacing;
    }
    const contentHeight = cursorY - spacing;
    const finalHeight = gooseCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }

  // catalog/build-toggle.ts
  function buildToggle(W, H, onBack, state, setState, rendererRef, palette = gooseLight, single = false, cardOnly = false) {
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const TOGGLE_ACCENT_T = palette.toggleAccent;
    const TOGGLE_TRACK_T = palette.toggleTrackOff;
    const CARD_BG_T = palette.toggleCardBg;
    const TOGGLE_W = 64 * gooseDP2;
    const TOGGLE_H = 28 * gooseDP2;
    const TOGGLE_KNOB_W = 40 * gooseDP2;
    const TOGGLE_KNOB_H = 24 * gooseDP2;
    const TOGGLE_DRAG = 20 * gooseDP2;
    const TOGGLE_PADDING = 2 * gooseDP2;
    const KNOB_REFRACTION_HEIGHT = 5 * gooseDP2;
    const KNOB_REFRACTION_AMOUNT = -10 * gooseDP2;
    const KNOB_BLUR_RADIUS = 8 * gooseDP2;
    const KNOB_HIGHLIGHT = null;
    const KNOB_OUTER_SHADOW = {
      radius: 4 * gooseDP2,
      alpha: 0.05,
      // Black.copy(alpha=0.05f)
      offsetX: 0,
      offsetY: 4 / 6 * gooseDP2,
      // 默认偏移 = radius/6
      color: [0, 0, 0]
    };
    const KNOB_INNER_SHADOW = {
      radius: 4 * gooseDP2,
      alpha: 0.15,
      // InnerShadow 默认颜色 alpha；渲染器会乘以进度
      offsetX: 0,
      offsetY: 4 * gooseDP2
      // 默认偏移 = radius；渲染器按进度调制
    };
    const drawWall = !single || !cardOnly;
    const drawCard = !single || cardOnly;
    const t1CenterX = W / 2;
    const t1TrackX = t1CenterX - TOGGLE_W / 2;
    const t1TrackY = 0;
    const t1KnobX = t1TrackX + TOGGLE_PADDING;
    const t1KnobY = t1TrackY + (TOGGLE_H - TOGGLE_KNOB_H) / 2;
    if (drawWall) {
      const t1TrackEl = gooseRect(
        "toggle1-track",
        { x: t1TrackX, y: t1TrackY, w: TOGGLE_W, h: TOGGLE_H },
        TOGGLE_TRACK_T,
        TOGGLE_H / 2
        // 胶囊体 = height/2
      );
      t1TrackEl.isToggleTrack = {
        groupId: "toggle1",
        offColor: TOGGLE_TRACK_T,
        onColor: [...TOGGLE_ACCENT_T, 1]
      };
      elements.push(t1TrackEl);
      const t1KnobEl = gooseGlass(
        "toggle1-knob",
        { x: t1KnobX, y: t1KnobY, w: TOGGLE_KNOB_W, h: TOGGLE_KNOB_H },
        {
          cornerRadius: TOGGLE_KNOB_H / 2,
          // 胶囊体 = height/2
          refractionHeight: KNOB_REFRACTION_HEIGHT,
          refractionAmount: KNOB_REFRACTION_AMOUNT,
          blurRadius: KNOB_BLUR_RADIUS,
          saturation: 1,
          // 无饱和度增强 — toggle effects 块仅包含 blur+lens
          surfaceColor: [0, 0, 0, 0],
          // 无 surface — 白色叠加层处理其余部分
          highlight: KNOB_HIGHLIGHT,
          outerShadow: KNOB_OUTER_SHADOW,
          innerShadow: KNOB_INNER_SHADOW,
          chromaticAberration: true
          // lens(chromaticAberration = true)
        }
      );
      t1KnobEl.isToggleKnob = {
        groupId: "toggle1",
        dragWidth: TOGGLE_DRAG,
        // CombinedBackdrop（LiquidToggle.kt）：backdrop=LayerBackdrop（壁纸），trackBackdrop 在 track 原始位置捕获（固定）。
        // 旋钮采样壁纸（未缩放）+ 缩放后的 track 颜色矩形；track 颜色在 trackColor(off) 与 accentColor(on) 间插值。
        //   trackColor   = Color(0xFF787878).copy(0.2f) → RGBA(120,120,120,0.2)
        //   accentColor  = Color(0xFF34C759)            → RGBA(52,199,89,1.0)
        trackColorOff: TOGGLE_TRACK_T,
        trackColorOn: [...TOGGLE_ACCENT_T, 1],
        trackW: TOGGLE_W,
        trackH: TOGGLE_H,
        // Track 原始屏幕位置（固定，不随旋钮移动）。缩放枢轴为旋钮当前中心，缩放后 track 内容部分随旋钮移动（比率=1-scale）。
        trackOriginalX: t1TrackX,
        trackOriginalY: t1TrackY
        // 无 solidBackdropColor → 采样壁纸纹理（LayerBackdrop）。
      };
      elements.push(t1KnobEl);
    }
    let cardBottom = 24 * gooseDP2;
    if (drawCard) {
      const VISIBLE_CARD_W = 176 * gooseDP2;
      const VISIBLE_CARD_H = 76 * gooseDP2;
      const cardX = (W - VISIBLE_CARD_W) / 2;
      const cardY = drawWall ? t1TrackY + TOGGLE_H + 16 + 24 : 24 * gooseDP2;
      const cardW = VISIBLE_CARD_W;
      const cardH = VISIBLE_CARD_H;
      const cardRadius = 32 * gooseDP2;
      const cardBg = CARD_BG_T;
      elements.push(gooseRect("toggle-card", { x: cardX, y: cardY, w: cardW, h: cardH }, cardBg, cardRadius));
      const t2TrackX = cardX + 24 + 32;
      const t2TrackY = cardY + 24;
      const t2KnobX = t2TrackX + TOGGLE_PADDING;
      const t2KnobY = t2TrackY + (TOGGLE_H - TOGGLE_KNOB_H) / 2;
      const t2TrackEl = gooseRect(
        "toggle2-track",
        { x: t2TrackX, y: t2TrackY, w: TOGGLE_W, h: TOGGLE_H },
        TOGGLE_TRACK_T,
        TOGGLE_H / 2
      );
      t2TrackEl.isToggleTrack = {
        groupId: "toggle2",
        offColor: TOGGLE_TRACK_T,
        onColor: [...TOGGLE_ACCENT_T, 1]
      };
      elements.push(t2TrackEl);
      const t2KnobEl = gooseGlass(
        "toggle2-knob",
        { x: t2KnobX, y: t2KnobY, w: TOGGLE_KNOB_W, h: TOGGLE_KNOB_H },
        {
          cornerRadius: TOGGLE_KNOB_H / 2,
          refractionHeight: KNOB_REFRACTION_HEIGHT,
          refractionAmount: KNOB_REFRACTION_AMOUNT,
          blurRadius: KNOB_BLUR_RADIUS,
          saturation: 1,
          surfaceColor: [0, 0, 0, 0],
          highlight: KNOB_HIGHLIGHT,
          outerShadow: KNOB_OUTER_SHADOW,
          innerShadow: KNOB_INNER_SHADOW,
          chromaticAberration: true
        }
      );
      t2KnobEl.isToggleKnob = {
        groupId: "toggle2",
        dragWidth: TOGGLE_DRAG,
        // CombinedBackdrop（LiquidToggle.kt）：backdrop=rememberCanvasBackdrop{drawRect(backgroundColor)}（t2 用纯色卡片），
        // trackBackdrop 在 track 原始位置捕获（固定）。旋钮采样卡片纯色 + 缩放后的 track 颜色矩形。
        //   trackColor   = Color(0xFF787878).copy(0.2f) → RGBA(120,120,120,0.2)
        //   accentColor  = Color(0xFF34C759)            → RGBA(52,199,89,1.0)
        trackColorOff: TOGGLE_TRACK_T,
        trackColorOn: [...TOGGLE_ACCENT_T, 1],
        trackW: TOGGLE_W,
        trackH: TOGGLE_H,
        // Track 原始屏幕位置（固定，不随旋钮移动）。
        trackOriginalX: t2TrackX,
        trackOriginalY: t2TrackY,
        // Solid backdrop：卡片背景色（ToggleContent.kt 的 rememberCanvasBackdrop{drawRect}）。设置后着色器用此色而非采样壁纸。
        solidBackdropColor: cardBg
      };
      elements.push(t2KnobEl);
      cardBottom = cardY + cardH + 24;
    }
    const makeToggleInteract = (groupId, dragWidth) => gooseDrag({
      groupId,
      trackX: 0,
      dragW: dragWidth,
      rendererRef,
      onValueChange: (f) => {
        const finalOn = f >= 0.5;
        setState((prev) => prev.toggleOn === finalOn ? prev : { toggleOn: finalOn });
      },
      ...toggleDragBindings,
      snap: (f) => f >= 0.5 ? 1 : 0,
      // 吸附到 0 或 1
      onTapJump: false
      // 点击 = 翻转（由下面的自定义 onTap 处理）
    });
    if (drawWall) {
      const toggle1Interact = makeToggleInteract("toggle1", TOGGLE_DRAG);
      toggle1Interact.onTap = () => setState((prev) => ({ toggleOn: !prev.toggleOn }));
      interactions["toggle1-track"] = toggle1Interact;
      interactions["toggle1-knob"] = toggle1Interact;
    }
    if (drawCard) {
      const toggle2Interact = makeToggleInteract("toggle2", TOGGLE_DRAG);
      toggle2Interact.onTap = () => setState((prev) => ({ toggleOn: !prev.toggleOn }));
      interactions["toggle2-track"] = toggle2Interact;
      interactions["toggle2-knob"] = toggle2Interact;
    }
    const contentHeight = cardBottom;
    const finalHeight = gooseCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }

  // catalog/build-slider.ts
  function buildSlider(W, H, onBack, state, setState, rendererRef, palette = gooseLight, single = false, cardOnly = false) {
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const SLIDER_ACCENT_T = palette.sliderAccent;
    const SLIDER_TRACK_T = palette.sliderTrackOff;
    const CARD_BG_T = palette.sliderCardBg;
    const SLIDER_PAD = 32 * gooseDP2;
    const gooseTrackH3 = 6 * gooseDP2;
    const gooseKnobW3 = 40 * gooseDP2;
    const gooseKnobH3 = 24 * gooseDP2;
    const drawWall = !single || !cardOnly;
    const drawCard = !single || cardOnly;
    const s1TrackX = SLIDER_PAD;
    const s1TrackY = 0;
    const s1TrackW = W - 2 * SLIDER_PAD;
    const s1KnobBaseX = s1TrackX - gooseKnobW3 / 4;
    const s1KnobY = s1TrackY + (gooseTrackH3 - gooseKnobH3) / 2;
    const gooseHitH3 = 48 * gooseDP2;
    const SLIDER_KNOB_HIT_H = 48 * gooseDP2;
    if (drawWall) {
      const s1TrackEl = gooseRect("slider1-track", { x: s1TrackX, y: s1TrackY, w: s1TrackW, h: gooseTrackH3 }, SLIDER_TRACK_T, gooseTrackH3 / 2);
      s1TrackEl.hitRect = { x: s1TrackX, y: s1TrackY + (gooseTrackH3 - gooseHitH3) / 2, w: s1TrackW, h: gooseHitH3 };
      elements.push(s1TrackEl);
      const s1FillEl = gooseRect("slider1-fill", { x: s1TrackX, y: s1TrackY, w: gooseTrackH3, h: gooseTrackH3 }, [...SLIDER_ACCENT_T, 1], gooseTrackH3 / 2);
      s1FillEl.isSliderFill = { groupId: "slider1", trackX: s1TrackX, trackW: s1TrackW, knobW: gooseKnobW3, minW: 0 };
      elements.push(s1FillEl);
      const s1KnobEl = gooseGlass(
        "slider1-knob",
        { x: s1KnobBaseX, y: s1KnobY, w: gooseKnobW3, h: gooseKnobH3 },
        {
          cornerRadius: gooseKnobH3 / 2,
          refractionHeight: 10 * gooseDP2,
          // 按下时的透镜高度（比 toggle 大）
          refractionAmount: -14 * gooseDP2,
          // 按下时的透镜强度
          blurRadius: 8 * gooseDP2,
          // 静止时的磨砂模糊（由渲染器调制）
          saturation: 1,
          // 不提升饱和度 — slider 的 effects 块仅包含 blur+lens
          surfaceColor: [0, 0, 0, 0],
          highlight: null,
          outerShadow: { radius: 4 * gooseDP2, alpha: 0.05, offsetX: 0, offsetY: 4 / 6 * gooseDP2, color: [0, 0, 0] },
          innerShadow: { radius: 4 * gooseDP2, alpha: 0.15, offsetX: 0, offsetY: 4 * gooseDP2 },
          chromaticAberration: true
        }
      );
      s1KnobEl.isToggleKnob = { groupId: "slider1", dragWidth: s1TrackW - gooseKnobW3 / 2, velocityDivisor: 10 };
      s1KnobEl.hitRect = {
        x: s1KnobBaseX,
        y: s1KnobY + (gooseKnobH3 - SLIDER_KNOB_HIT_H) / 2,
        w: gooseKnobW3,
        h: SLIDER_KNOB_HIT_H
      };
      elements.push(s1KnobEl);
    }
    let cardContentBottom = s1TrackY + gooseKnobH3 + 24 * gooseDP2;
    const VISIBLE_CARD_H = 24 + 48;
    const cardX = 24 * gooseDP2;
    const cardW = W - 2 * cardX;
    const cardH = VISIBLE_CARD_H;
    const cardY = drawWall ? s1TrackY + gooseKnobH3 + 16 + 24 : 24 * gooseDP2;
    const cardRadius = 32 * gooseDP2;
    const s2TrackX = cardX + 24 + SLIDER_PAD;
    const s2TrackW = cardW - 2 * 24 - 2 * SLIDER_PAD;
    const s2TrackY = cardY + 24 + (gooseKnobH3 - gooseTrackH3) / 2;
    const s2KnobBaseX = s2TrackX - gooseKnobW3 / 4;
    const s2KnobY = s2TrackY + (gooseTrackH3 - gooseKnobH3) / 2;
    if (drawCard) {
      elements.push(gooseRect("slider-card", { x: cardX, y: cardY, w: cardW, h: cardH }, CARD_BG_T, cardRadius));
      const s2TrackEl = gooseRect("slider2-track", { x: s2TrackX, y: s2TrackY, w: s2TrackW, h: gooseTrackH3 }, SLIDER_TRACK_T, gooseTrackH3 / 2);
      s2TrackEl.hitRect = { x: s2TrackX, y: s2TrackY + (gooseTrackH3 - gooseHitH3) / 2, w: s2TrackW, h: gooseHitH3 };
      elements.push(s2TrackEl);
      const s2FillEl = gooseRect("slider2-fill", { x: s2TrackX, y: s2TrackY, w: gooseTrackH3, h: gooseTrackH3 }, [...SLIDER_ACCENT_T, 1], gooseTrackH3 / 2);
      s2FillEl.isSliderFill = { groupId: "slider2", trackX: s2TrackX, trackW: s2TrackW, knobW: gooseKnobW3, minW: 0 };
      elements.push(s2FillEl);
      const s2KnobEl = gooseGlass(
        "slider2-knob",
        { x: s2KnobBaseX, y: s2KnobY, w: gooseKnobW3, h: gooseKnobH3 },
        {
          cornerRadius: gooseKnobH3 / 2,
          refractionHeight: 10 * gooseDP2,
          refractionAmount: -14 * gooseDP2,
          blurRadius: 8 * gooseDP2,
          saturation: 1,
          // 不提升饱和度 — slider 的 effects 块仅包含 blur+lens
          surfaceColor: [0, 0, 0, 0],
          highlight: null,
          outerShadow: { radius: 4 * gooseDP2, alpha: 0.05, offsetX: 0, offsetY: 4 / 6 * gooseDP2, color: [0, 0, 0] },
          innerShadow: { radius: 4 * gooseDP2, alpha: 0.15, offsetX: 0, offsetY: 4 * gooseDP2 },
          chromaticAberration: true
        }
      );
      s2KnobEl.isToggleKnob = { groupId: "slider2", dragWidth: s2TrackW - gooseKnobW3 / 2, velocityDivisor: 10 };
      s2KnobEl.hitRect = {
        x: s2KnobBaseX,
        y: s2KnobY + (gooseKnobH3 - SLIDER_KNOB_HIT_H) / 2,
        w: gooseKnobW3,
        h: SLIDER_KNOB_HIT_H
      };
      elements.push(s2KnobEl);
      cardContentBottom = cardY + cardH + 24 * gooseDP2;
    }
    const SLIDER_DRAG_W1 = s1TrackW - gooseKnobW3 / 2;
    const makeSliderInteract = (groupId, trackX, dragW) => gooseDrag({
      groupId,
      trackX,
      dragW,
      rendererRef,
      onValueChange: (f) => setState({ sliderValue: f * 100 }),
      ...sliderDragBindings,
      // 不使用 liveUpdate — 仅在 dragEnd 同步，避免与 toggleTargets effect 反馈循环冲突
      liveUpdate: false
    });
    if (drawWall) {
      interactions["slider1-track"] = makeSliderInteract("slider1", s1TrackX, SLIDER_DRAG_W1);
      interactions["slider1-knob"] = interactions["slider1-track"];
    }
    if (drawCard) {
      const SLIDER_DRAG_W2 = s2TrackW - gooseKnobW3 / 2;
      interactions["slider2-track"] = makeSliderInteract("slider2", s2TrackX, SLIDER_DRAG_W2);
      interactions["slider2-knob"] = interactions["slider2-track"];
    }
    const contentHeight = cardContentBottom;
    const finalHeight = gooseCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }

  // catalog/build-bottom-tabs.ts
  function buildBottomTabs(W, H, onBack, state, setState, rendererRef = null, palette = gooseLight, tabsConfig, single = false, second = false) {
    var _a, _b;
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const TABS_PAD = 36 * gooseDP2;
    const TABS_W = W - 2 * TABS_PAD;
    const iconColor = palette.tabsContentColor;
    const containerColor = palette.tabsContainer;
    const accentT = palette.tabsAccent;
    const CONTAINER_H = 64 * gooseDP2;
    const GLASS_H = 56 * gooseDP2;
    const GLASS_PAD = 4 * gooseDP2;
    const containerX = TABS_PAD;
    const containerW = TABS_W;
    const containerR = CONTAINER_H / 2;
    const glassX = TABS_PAD + GLASS_PAD;
    const glassW = TABS_W - 2 * GLASS_PAD;
    const glassR = GLASS_H / 2;
    function buildTabBar(idPrefix, tabs, selectedTab, onSelect, y) {
      var _a2, _b2, _c;
      const tabsCount = tabs ? tabs.length : 3;
      const tabW = glassW / tabsCount;
      const glassY = y + GLASS_PAD;
      const containerEl = gooseGlass(
        `${idPrefix}-container`,
        { x: containerX, y, w: containerW, h: CONTAINER_H },
        {
          cornerRadius: containerR,
          // 32dp 胶囊形状
          refractionHeight: 24 * gooseDP2,
          refractionAmount: -24 * gooseDP2,
          blurRadius: 8 * gooseDP2,
          saturation: 1.5,
          surfaceColor: containerColor,
          // 容器使用默认 Highlight.Default（alpha=1.0, width=0.5dp）
          highlight: { ...gooseHL, alpha: 1 },
          outerShadow: null,
          depthEffect: true
        }
      );
      containerEl.isBottomTabContainer = { groupId: idPrefix, tabsCount };
      elements.push(containerEl);
      const dragInteractions = gooseTabDrag(idPrefix, tabW, tabsCount, onSelect, rendererRef);
      for (let i = 0; i < tabsCount; i++) {
        const id = `${idPrefix}-tab-${i}`;
        const cfg = tabs == null ? void 0 : tabs[i];
        const iconPath = (_a2 = cfg == null ? void 0 : cfg.icon) != null ? _a2 : gooseFlight;
        const label = (_b2 = cfg == null ? void 0 : cfg.label) != null ? _b2 : `Tab ${i + 1}`;
        const tabEl = gooseText(
          id,
          { x: glassX + tabW * i, y: glassY, w: tabW, h: GLASS_H },
          label,
          {
            color: palette.tabsContentColor,
            fontSizePx: 12,
            fontWeight: 400,
            align: "center",
            paddingPx: 0,
            halo: palette.tabsTextHalo,
            icon: { path: iconPath, size: 24, layoutSize: 28, color: iconColor, viewport: (_c = cfg == null ? void 0 : cfg.viewport) != null ? _c : 960 }
          }
        );
        tabEl.isBottomTabContent = {
          groupId: idPrefix,
          // 容器中心 = 整条 tab bar 的缩放原点（非各自中心）
          containerCenterX: containerX + containerW / 2,
          containerCenterY: y + CONTAINER_H / 2,
          containerWidth: containerW
        };
        elements.push(tabEl);
        interactions[id] = {
          onTap: () => onSelect(i),
          onDragStart: dragInteractions.onDragStart,
          onDrag: dragInteractions.onDrag,
          onDragEnd: dragInteractions.onDragEnd
        };
      }
      interactions[`${idPrefix}-container`] = dragInteractions;
      const indicatorEl = gooseGlass(
        `${idPrefix}-indicator`,
        // 指示器玻璃 x = TABS_PAD + 4dp。渲染器通过 toggleXOffset
        // 叠加 fraction*tabW（isBottomTabIndicator.dragWidth = tabW）。
        { x: TABS_PAD + GLASS_PAD, y: glassY, w: tabW, h: GLASS_H },
        {
          cornerRadius: glassR,
          refractionHeight: 10 * gooseDP2,
          refractionAmount: -14 * gooseDP2,
          // 指示器无 blur/vibrancy（仅按下时有 lens）
          blurRadius: 0,
          saturation: 1,
          // 指示器透明玻璃：变暗遮罩由 isBottomTabIndicator.dimColor 在 post-passes 处理
          tintColor: [0, 0, 0, 0],
          surfaceColor: [0, 0, 0, 0],
          // highlight alpha 随 pressProgress 调制（静止为0，按下满值）
          highlight: { ...gooseHL, alpha: 1 },
          // Shadow.Default，alpha 随 pressProgress 调制
          outerShadow: { radius: 24 * gooseDP2, alpha: 0.1, offsetX: 0, offsetY: 24 / 6 * gooseDP2, color: [0, 0, 0] },
          // InnerShadow color=Black(0.15)，radius/alpha 随 progress
          innerShadow: { radius: 8 * gooseDP2, alpha: 0.15, offsetX: 0, offsetY: 8 * gooseDP2 },
          chromaticAberration: true
        }
      );
      indicatorEl.isBottomTabIndicator = {
        groupId: idPrefix,
        dragWidth: tabW,
        dimColor: palette.backIconColor,
        // CombinedBackdrop：外层采壁纸，内层采场景 FBO，合成到内缩胶囊 SDF
        accentColor: [...accentT],
        // containerRect = 内层背景板胶囊（hidden Row 的 56dp 玻璃，四周内缩 4dp）
        containerRect: { x: glassX, y: glassY, w: glassW, h: GLASS_H },
        // 指示器围绕容器中心缩放（与 tab-content 一致）
        containerCenterX: containerX + containerW / 2,
        containerCenterY: y + CONTAINER_H / 2,
        containerWidth: containerW,
        // Tab content ID + rect —— 用于蓝色 tint 遮罩。渲染器
        // 查询每个 tab 的 fgTexture（icon+label alpha），
        // 仅将指示器内不透明的 icon/label 像素染成蓝色。
        tabContentIds: Array.from({ length: tabsCount }, (_, i) => `${idPrefix}-tab-${i}`),
        tabContentRects: Array.from({ length: tabsCount }, (_, i) => ({
          x: glassX + tabW * i,
          y: glassY,
          w: tabW,
          h: GLASS_H
        }))
      };
      elements.push(indicatorEl);
    }
    const drawFirst = !second;
    const drawSecond = !single || second;
    const secondY = drawFirst ? CONTAINER_H + 32 : 0;
    if (drawFirst) {
      buildTabBar("tabs3", (_a = tabsConfig == null ? void 0 : tabsConfig[0]) != null ? _a : null, state.selectedTab, (i) => setState({ selectedTab: i }), 0);
    }
    if (drawSecond) {
      const defaultTabs4 = [
        { icon: gooseFlight, label: "Tab 1" },
        { icon: gooseFlight, label: "Tab 2" },
        { icon: gooseFlight, label: "Tab 3" },
        { icon: gooseFlight, label: "Tab 4" }
      ];
      buildTabBar("tabs4", (_b = tabsConfig == null ? void 0 : tabsConfig[1]) != null ? _b : defaultTabs4, state.selectedTab2, (i) => setState({ selectedTab2: i }), secondY);
    }
    const bars = (drawFirst ? 1 : 0) + (drawSecond ? 1 : 0);
    const contentHeight = bars === 2 ? 2 * CONTAINER_H + 32 : CONTAINER_H;
    const finalHeight = gooseCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }

  // catalog/build-dialog.ts
  function buildDialog(W, H, onBack, state, palette = gooseLight, dialogConfig, onDialogTap) {
    var _a, _b, _c, _d;
    const elements = [];
    const interactions = {};
    const dlgTitle = (_a = dialogConfig == null ? void 0 : dialogConfig.title) != null ? _a : "Dialog Title";
    const dlgBody = (_b = dialogConfig == null ? void 0 : dialogConfig.body) != null ? _b : gooseLorem;
    const dlgCancel = (_c = dialogConfig == null ? void 0 : dialogConfig.cancelText) != null ? _c : "Cancel";
    const dlgOkay = (_d = dialogConfig == null ? void 0 : dialogConfig.okayText) != null ? _d : "Okay";
    const back = gooseBack(onBack, palette, true);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const scrim = gooseRect(
      "dialog-scrim",
      { x: 0, y: 0, w: W, h: H },
      palette.dialogDim,
      0
    );
    scrim.scroll = false;
    elements.push(scrim);
    const PAD = 40 * gooseDP2;
    const MAX_CARD_W = 420 * gooseDP2;
    const CARD_W = Math.min(W - 2 * PAD, MAX_CARD_W);
    const CARD_X = (W - CARD_W) / 2;
    const CARD_H = 276 * gooseDP2;
    const CARD_Y = (H - CARD_H) / 2;
    const card = gooseGlass(
      "dialog-card",
      { x: CARD_X, y: CARD_Y, w: CARD_W, h: CARD_H },
      {
        cornerRadius: 48 * gooseDP2,
        refractionHeight: 24 * gooseDP2,
        refractionAmount: -48 * gooseDP2,
        blurRadius: palette.dialogBlurRadius,
        saturation: 1.5,
        brightness: palette.dialogBrightness,
        surfaceColor: palette.dialogContainer,
        // Highlight.Plain：White(alpha=0.38)，alpha=1
        highlight: { ...gooseHL, mode: 2, color: [1, 1, 1], alpha: 0.38, widthDp: 0.5 },
        outerShadow: null,
        depthEffect: true
      }
    );
    card.useSeparableBlur = true;
    if (state.capsuleShape) {
      card.useContinuousSdf = true;
    }
    elements.push(card);
    elements.push(
      gooseText(
        "dialog-title",
        { x: CARD_X + 28, y: CARD_Y + 24, w: CARD_W - 56, h: 36 },
        dlgTitle,
        { color: palette.dialogContentColor, fontSizePx: 24, fontWeight: 500, align: "left", paddingPx: 0, halo: "none" }
      )
    );
    const isLight = palette.dialogBrightness > 0.1;
    const bodyAlpha = isLight ? 0.68 : 0.78;
    const bodyColor = [
      palette.dialogContentColor[0],
      palette.dialogContentColor[1],
      palette.dialogContentColor[2],
      bodyAlpha
    ];
    elements.push(
      gooseText(
        "dialog-body",
        { x: CARD_X + 24, y: CARD_Y + 68 + 12, w: CARD_W - 48, h: 100 },
        dlgBody,
        {
          color: bodyColor,
          fontSizePx: 15,
          fontWeight: 400,
          align: "left",
          wrap: true,
          valign: "top",
          maxLines: 5,
          paddingPx: 0,
          halo: "none"
        }
      )
    );
    const BTN_H = 48 * gooseDP2;
    const BTN_W = (CARD_W - 2 * 24 * gooseDP2 - 16 * gooseDP2) / 2;
    const BTN_Y = CARD_Y + CARD_H - 24 * gooseDP2 - BTN_H;
    const CANCEL_X = CARD_X + 24 * gooseDP2;
    const OKAY_X = CANCEL_X + BTN_W + 16 * gooseDP2;
    const cancelBtn = gooseBtn(
      "dialog-cancel",
      { x: CANCEL_X, y: BTN_Y, w: BTN_W, h: BTN_H },
      {
        label: "",
        tintColor: [0, 0, 0, 0],
        surfaceColor: [palette.dialogContainer[0], palette.dialogContainer[1], palette.dialogContainer[2], 0.2],
        labelColor: palette.dialogContentColor,
        saturation: 1,
        // 无 vibrancy —— Cancel 是实心背景，不是玻璃
        brightness: 0,
        contrast: 1
      },
      false
    );
    cancelBtn.refractionHeight = 0;
    cancelBtn.refractionAmount = 0;
    cancelBtn.blurRadius = 0;
    cancelBtn.highlight = null;
    cancelBtn.outerShadow = null;
    elements.push(cancelBtn);
    interactions["dialog-cancel"] = { onTap: () => onDialogTap == null ? void 0 : onDialogTap("cancel") };
    elements.push(
      gooseText(
        "dialog-cancel-label",
        { x: CANCEL_X, y: BTN_Y, w: BTN_W, h: BTN_H },
        dlgCancel,
        { color: palette.dialogContentColor, fontSizePx: 16, fontWeight: 400, align: "center", paddingPx: 0, halo: "none" }
      )
    );
    const okayBtn = gooseBtn(
      "dialog-okay",
      { x: OKAY_X, y: BTN_Y, w: BTN_W, h: BTN_H },
      {
        label: "",
        tintColor: [0, 0, 0, 0],
        surfaceColor: palette.dialogAccent,
        labelColor: [1, 1, 1, 1],
        saturation: 1,
        // 无 vibrancy — Okay 是实心背景
        brightness: 0,
        contrast: 1
      },
      false
    );
    okayBtn.refractionHeight = 0;
    okayBtn.refractionAmount = 0;
    okayBtn.blurRadius = 0;
    okayBtn.highlight = null;
    okayBtn.outerShadow = null;
    elements.push(okayBtn);
    interactions["dialog-okay"] = { onTap: () => onDialogTap == null ? void 0 : onDialogTap("okay") };
    elements.push(
      gooseText(
        "dialog-okay-label",
        { x: OKAY_X, y: BTN_Y, w: BTN_W, h: BTN_H },
        dlgOkay,
        { color: [1, 1, 1, 1], fontSizePx: 16, fontWeight: 400, align: "center", paddingPx: 0 }
      )
    );
    for (const el of elements) el.scroll = false;
    gooseCenter(elements, 0, H, H);
    return { elements, interactions, contentHeight: H };
  }

  // catalog/build-magnifier.ts
  var magDragStart = { x: 0, y: 0 };
  function measureWrappedHeight(text, fontPx, maxW) {
    const lineH = fontPx * 1.35;
    const words = text.split(/\s+/);
    let cur = "";
    let lines = 0;
    for (const word of words) {
      const test = cur ? cur + " " + word : word;
      if (gooseTextW(test, fontPx) <= maxW || !cur) {
        cur = test;
      } else {
        lines++;
        cur = word;
      }
    }
    if (cur) lines++;
    return lines * lineH;
  }
  function buildMagnifier(W, H, onBack, state, setState, palette = gooseLight) {
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const cardX = 24 * gooseDP2;
    const cardY = 0;
    const cardW = W - 2 * cardX;
    const cardRadius = 32 * gooseDP2;
    const innerPad = 24 * gooseDP2;
    const textW = cardW - 2 * innerPad;
    const fontPx = 16;
    const textH = measureWrappedHeight(gooseLorem, fontPx, textW);
    const cardH = textH + 2 * innerPad;
    elements.push(gooseRect("mag-card", { x: cardX, y: cardY, w: cardW, h: cardH }, palette.magnifierCardBg, cardRadius));
    elements.push(
      gooseText(
        "mag-text",
        { x: cardX + innerPad, y: cardY + innerPad, w: textW, h: textH },
        gooseLorem,
        {
          color: palette.magnifierContentColor,
          fontSizePx: fontPx,
          fontWeight: 400,
          align: "left",
          wrap: true,
          paddingPx: 0,
          halo: "none"
          // 卡片是实心的；无需 halo
        }
      )
    );
    const cursorBaseX = W / 2 - 2;
    const cursorBaseY = cardY + cardH / 2 - 12 * gooseDP2;
    const cursorX = cursorBaseX + state.magnifierX;
    const cursorY = cursorBaseY + state.magnifierY;
    const cursorEl = gooseRect("mag-cursor", { x: cursorX, y: cursorY, w: 4 * gooseDP2, h: 24 * gooseDP2 }, palette.magnifierAccent, 2 * gooseDP2);
    cursorEl.hitRect = { x: cursorX - 22 * gooseDP2, y: cursorY - 12 * gooseDP2, w: 48 * gooseDP2, h: 48 * gooseDP2 };
    elements.push(cursorEl);
    const magW = 128 * gooseDP2;
    const magH = 96 * gooseDP2;
    const magX = cursorX + 2 - magW / 2;
    const magY = cursorY + 12 - 80 * gooseDP2 - magH / 2;
    const magGlass = gooseGlass(
      "mag-glass",
      { x: magX, y: magY, w: magW, h: magH },
      {
        cornerRadius: magH / 2,
        refractionHeight: 8 * gooseDP2,
        refractionAmount: -24 * gooseDP2,
        blurRadius: 0,
        saturation: 1,
        surfaceColor: [0, 0, 0, 0],
        // drawBackdrop 使用默认 highlight + 默认 shadow
        highlight: { ...gooseHL },
        outerShadow: { ...gooseShadow },
        // InnerShadow(radius=16dp) 默认值
        innerShadow: { radius: 16 * gooseDP2, alpha: 0.15, offsetX: 0, offsetY: 16 * gooseDP2 },
        depthEffect: true,
        chromaticAberration: true
      }
    );
    magGlass.isMagnifier = { zoom: 1.5, sampleOffsetY: 80 * gooseDP2 };
    elements.push(magGlass);
    const magDragHandler = {
      onDragStart: () => {
        magDragStart.x = state.magnifierX;
        magDragStart.y = state.magnifierY;
      },
      onDrag: (_pos, delta) => {
        setState({
          magnifierX: magDragStart.x + delta.x,
          magnifierY: magDragStart.y + delta.y
        });
      },
      onDragEnd: () => {
      }
    };
    interactions["mag-glass"] = magDragHandler;
    interactions["mag-cursor"] = magDragHandler;
    const contentHeight = cardH;
    const finalHeight = gooseCenter(elements, 0, contentHeight, H);
    return { elements, interactions, contentHeight: finalHeight };
  }

  // catalog/build-scroll-container.ts
  function buildScrollContainer(W, onBack, count, palette = gooseLight, scrollConfig, onLinkTap) {
    const elements = [];
    const interactions = {};
    const back = gooseBack(onBack, palette);
    elements.push(back.element);
    interactions[back.element.id] = back.interaction;
    const pad = 16 * gooseDP2;
    const spacing = 16 * gooseDP2;
    const cardW = W - 2 * pad;
    const cardH = 160 * gooseDP2;
    const items = scrollConfig && scrollConfig.length > 0 ? scrollConfig : null;
    const n = items ? items.length : count;
    let y = 80;
    for (let i = 0; i < n; i++) {
      elements.push(
        gooseGlass(
          `sc-card-${i}`,
          { x: pad, y, w: cardW, h: cardH },
          {
            cornerRadius: 32 * gooseDP2,
            refractionHeight: 16 * gooseDP2,
            refractionAmount: -32 * gooseDP2,
            blurRadius: 0,
            // 无 blur，仅 vibrancy + lens
            saturation: 1.5,
            surfaceColor: [0, 0, 0, 0],
            highlight: { ...gooseHL },
            outerShadow: null
          }
        )
      );
      const item = items == null ? void 0 : items[i];
      if (item) {
        elements.push(
          gooseText(
            `sc-title-${i}`,
            { x: pad + 16 * gooseDP2, y: y + 18 * gooseDP2, w: cardW - 32 * gooseDP2, h: 24 * gooseDP2 },
            item.title,
            {
              color: palette.homeContentColor,
              fontSizePx: 17,
              fontWeight: 600,
              align: "left",
              valign: "top",
              paddingPx: 0,
              scroll: true,
              halo: palette.homeTextHalo
            }
          )
        );
        if (item.subtitle) {
          elements.push(
            gooseText(
              `sc-sub-${i}`,
              { x: pad + 16 * gooseDP2, y: y + 18 * gooseDP2 + 28 * gooseDP2, w: cardW - 32 * gooseDP2, h: 20 * gooseDP2 },
              item.subtitle,
              {
                color: palette.homeSubtitleColor,
                fontSizePx: 14,
                fontWeight: 400,
                align: "left",
                valign: "top",
                paddingPx: 0,
                scroll: true,
                halo: palette.homeTextHalo
              }
            )
          );
        }
        if (item.link && item.link.text) {
          const linkColor = palette.homeTextHalo === "dark" ? [0.1, 0.4, 0.9, 1] : [0.36, 0.58, 1, 1];
          const linkEl = gooseText(
            `sc-link-${i}`,
            { x: pad + 16 * gooseDP2, y: y + cardH - 34 * gooseDP2, w: cardW - 32 * gooseDP2, h: 22 * gooseDP2 },
            item.link.text,
            {
              color: linkColor,
              fontSizePx: 15,
              fontWeight: 600,
              align: "left",
              valign: "center",
              paddingPx: 0,
              scroll: true,
              halo: palette.homeTextHalo
            }
          );
          linkEl.isInteractive = true;
          elements.push(linkEl);
          if (onLinkTap) {
            interactions[`sc-link-${i}`] = { onTap: () => {
              var _a;
              return onLinkTap(i, (_a = item.link) == null ? void 0 : _a.href);
            } };
          }
        }
      }
      y += cardH + spacing;
    }
    return { elements, interactions, contentHeight: y + 16 };
  }

  // catalog/build-rating.ts
  var STAR_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  var STARS = 5;
  var STAR_SIZE = 36 * gooseDP2;
  var STAR_GAP = 12 * gooseDP2;
  var STAR_VIEWPORT = 24;
  var TOP_PAD = 60 * gooseDP2;
  function buildRating(W, H, onBack, state, setState, rendererRef, palette) {
    const p = palette != null ? palette : goosePalette(true);
    const elements = [];
    const interactions = {};
    const totalW = STARS * STAR_SIZE + (STARS - 1) * STAR_GAP;
    const startX = (W - totalW) / 2;
    const starY = Math.max(TOP_PAD, (H - STAR_SIZE) / 2);
    const back = gooseBack(onBack, p);
    elements.push(back.element);
    if (back.interaction) interactions[back.element.id] = back.interaction;
    const filledColor = [255 / 255, 204 / 255, 0 / 255, 1];
    const emptyColor = [0.4, 0.4, 0.4, 0.5];
    for (let i = 0; i < STARS; i++) {
      const starId = `star-${i}`;
      const x = startX + i * (STAR_SIZE + STAR_GAP);
      const centerX = x + STAR_SIZE / 2;
      const centerY = starY + STAR_SIZE / 2;
      const isFilled = state.ratingValue > i;
      const iconColor = isFilled ? filledColor : emptyColor;
      const starEl = {
        id: starId,
        kind: "button",
        rect: { x, y: starY, w: STAR_SIZE, h: STAR_SIZE },
        cornerRadius: STAR_SIZE / 2,
        // 圆形
        refractionHeight: 6 * gooseDP2,
        refractionAmount: -12 * gooseDP2,
        depthEffect: false,
        chromaticAberration: false,
        blurRadius: 2 * gooseDP2,
        saturation: 1.5,
        brightness: 0,
        contrast: 1,
        tintColor: [0, 0, 0, 0],
        surfaceColor: isFilled ? [255 / 255, 204 / 255, 0 / 255, 0.15] : [0.5, 0.5, 0.5, 0.1],
        highlight: gooseHL,
        outerShadow: { radius: 8 * gooseDP2, alpha: 0.15, offsetX: 0, offsetY: 2 * gooseDP2, color: [0, 0, 0] },
        label: "",
        labelColor: [1, 1, 1, 1],
        showChevron: false,
        isInteractive: true,
        icon: {
          path: STAR_PATH,
          size: STAR_SIZE * 0.7,
          color: iconColor,
          viewport: STAR_VIEWPORT,
          layoutSize: STAR_SIZE
        }
      };
      elements.push(starEl);
      interactions[starId] = {
        onTap: () => {
          const newVal = state.ratingValue === i + 1 ? 0 : i + 1;
          setState({ ratingValue: newVal });
        },
        onDragStart: () => {
        },
        onDrag: () => {
        },
        onDragEnd: () => {
        }
      };
    }
    const contentHeight = Math.max(H, starY + STAR_SIZE + 20 * gooseDP2);
    return { elements, interactions, contentHeight };
  }

  // catalog/build-ring-progress.ts
  var RING_SIZE = 180 * gooseDP2;
  var RING_THICKNESS = 20 * gooseDP2;
  var INNER_R = RING_SIZE / 2 - RING_THICKNESS;
  var OUTER_R = RING_SIZE / 2;
  var TOP_PAD2 = 60 * gooseDP2;
  function ringArcPath(cx, cy, r1, r2, a1, a2) {
    const adj = (a) => a - Math.PI / 2;
    const s1 = adj(a1), s2 = adj(a2);
    const cos1 = Math.cos(s1), sin1 = Math.sin(s1);
    const cos2 = Math.cos(s2), sin2 = Math.sin(s2);
    const x1o = cx + r2 * cos1, y1o = cy + r2 * sin1;
    const x2o = cx + r2 * cos2, y2o = cy + r2 * sin2;
    const x1i = cx + r1 * cos2, y1i = cy + r1 * sin2;
    const x2i = cx + r1 * cos1, y2i = cy + r1 * sin1;
    const sweep = a2 - a1;
    const largeArc = sweep > Math.PI ? 1 : 0;
    return [
      `M ${x1o} ${y1o}`,
      `A ${r2} ${r2} 0 ${largeArc} 1 ${x2o} ${y2o}`,
      `L ${x1i} ${y1i}`,
      `A ${r1} ${r1} 0 ${largeArc} 0 ${x2i} ${y2i}`,
      "Z"
    ].join(" ");
  }
  function buildRingProgress(W, H, onBack, state, setState, rendererRef, palette) {
    const p = palette;
    const elements = [];
    const interactions = {};
    const cx = W / 2;
    const cy = Math.max(TOP_PAD2 + RING_SIZE / 2, H / 2);
    const rx = cx - RING_SIZE / 2;
    const ry = cy - RING_SIZE / 2;
    const back = gooseBack(onBack, p);
    elements.push(back.element);
    if (back.interaction) interactions[back.element.id] = back.interaction;
    elements.push({
      id: "ring-bg",
      kind: "glass-shape",
      rect: { x: rx, y: ry, w: RING_SIZE, h: RING_SIZE },
      cornerRadius: RING_SIZE / 2,
      refractionHeight: 8 * gooseDP2,
      refractionAmount: -16 * gooseDP2,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 3 * gooseDP2,
      saturation: 1.5,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: p.buttonSurface,
      highlight: gooseHL,
      outerShadow: gooseShadow,
      label: "",
      labelColor: [1, 1, 1, 1],
      showChevron: false,
      isInteractive: false
    });
    const progress = state.ringProgressValue;
    const frac = progress / 100;
    const fillAngle = frac * Math.PI * 2;
    const accentColor = [0 / 255, 145 / 255, 255 / 255, 1];
    const trackColor = [0.3, 0.3, 0.3, 0.3];
    const trackPath = ringArcPath(cx - rx, cy - ry, INNER_R, OUTER_R, 0, Math.PI * 2);
    elements.push({
      id: "ring-track",
      kind: "button",
      rect: { x: rx, y: ry, w: RING_SIZE, h: RING_SIZE },
      cornerRadius: RING_SIZE / 2,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [1, 1, 1, 1],
      showChevron: false,
      isInteractive: false,
      icon: {
        path: trackPath,
        size: RING_SIZE,
        color: trackColor,
        viewport: RING_SIZE
      }
    });
    if (fillAngle > 1e-3) {
      const fillPath = ringArcPath(cx - rx, cy - ry, INNER_R, OUTER_R, 0, fillAngle);
      elements.push({
        id: "ring-fill",
        kind: "button",
        rect: { x: rx, y: ry, w: RING_SIZE, h: RING_SIZE },
        cornerRadius: RING_SIZE / 2,
        refractionHeight: 0,
        refractionAmount: 0,
        depthEffect: false,
        chromaticAberration: false,
        blurRadius: 0,
        saturation: 1,
        brightness: 0,
        contrast: 1,
        tintColor: [0, 0, 0, 0],
        surfaceColor: [0, 0, 0, 0],
        highlight: null,
        outerShadow: null,
        label: "",
        labelColor: [1, 1, 1, 1],
        showChevron: false,
        isInteractive: false,
        icon: {
          path: fillPath,
          size: RING_SIZE,
          color: accentColor,
          viewport: RING_SIZE
        }
      });
    }
    const labelText = `${Math.round(progress)}%`;
    const labelFontPx = 36 * gooseDP2;
    elements.push({
      id: "ring-label",
      kind: "text",
      rect: { x: rx, y: ry, w: RING_SIZE, h: RING_SIZE },
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [1, 1, 1, 1],
      showChevron: false,
      isInteractive: false,
      text: {
        content: labelText,
        color: p.homeContentColor,
        fontSizePx: labelFontPx,
        fontWeight: 700,
        align: "center",
        valign: "center"
      }
    });
    const halfW = RING_SIZE / 2;
    elements.push({
      id: "ring-dec",
      kind: "button",
      rect: { x: rx, y: ry, w: halfW, h: RING_SIZE },
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [1, 1, 1, 1],
      showChevron: false,
      isInteractive: true
    });
    interactions["ring-dec"] = {
      onTap: () => {
        setState({ ringProgressValue: Math.max(0, state.ringProgressValue - 10) });
      },
      onDragStart: () => {
      },
      onDrag: () => {
      },
      onDragEnd: () => {
      }
    };
    elements.push({
      id: "ring-inc",
      kind: "button",
      rect: { x: rx + halfW, y: ry, w: halfW, h: RING_SIZE },
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: "",
      labelColor: [1, 1, 1, 1],
      showChevron: false,
      isInteractive: true
    });
    interactions["ring-inc"] = {
      onTap: () => {
        setState({ ringProgressValue: Math.min(100, state.ringProgressValue + 10) });
      },
      onDragStart: () => {
      },
      onDrag: () => {
      },
      onDragEnd: () => {
      }
    };
    const contentHeight = Math.max(H, ry + RING_SIZE + 20 * gooseDP2);
    return { elements, interactions, contentHeight };
  }

  // catalog/index.ts
  function gooseBuild(dest, W, H, state, setState, onNavigate, onBack, rendererRef, isLightTheme = true, onToggleTheme, onPickImage, onButtonTap, tabsConfig, buttonsConfig, dialogConfig, onDialogTap, scrollConfig, onLinkTap) {
    const palette = goosePalette(isLightTheme);
    let result;
    switch (dest) {
      case 1 /* Buttons */:
        result = buildButtons(W, H, onBack, palette, onButtonTap, buttonsConfig);
        break;
      case 2 /* Toggle */:
        result = buildToggle(W, H, onBack, state, setState, rendererRef, palette);
        break;
      case 4 /* Slider */:
        result = buildSlider(W, H, onBack, state, setState, rendererRef, palette);
        break;
      case 5 /* SingleSlider */:
        result = buildSlider(W, H, onBack, state, setState, rendererRef, palette, true);
        break;
      case 3 /* SingleToggle */:
        result = buildToggle(W, H, onBack, state, setState, rendererRef, palette, true);
        break;
      case 7 /* SingleBottomTabs */:
        result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig, true);
        break;
      case 8 /* ToggleCard */:
        result = buildToggle(W, H, onBack, state, setState, rendererRef, palette, true, true);
        break;
      case 9 /* SliderCard */:
        result = buildSlider(W, H, onBack, state, setState, rendererRef, palette, true, true);
        break;
      case 10 /* BottomTabs2 */:
        result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig, true, true);
        break;
      case 6 /* BottomTabs */:
        result = buildBottomTabs(W, H, onBack, state, setState, rendererRef, palette, tabsConfig);
        break;
      case 11 /* Dialog */:
        result = buildDialog(W, H, onBack, state, palette, dialogConfig, onDialogTap);
        break;
      case 14 /* Magnifier */:
        result = buildMagnifier(W, H, onBack, state, setState, palette);
        break;
      case 18 /* ScrollContainer */:
        result = buildScrollContainer(W, onBack, 20, palette, scrollConfig, onLinkTap);
        break;
      case 19 /* LazyScrollContainer */:
        result = buildScrollContainer(W, onBack, 100, palette, scrollConfig, onLinkTap);
        break;
      case 22 /* Rating */:
        result = buildRating(W, H, onBack, state, setState, rendererRef, palette);
        break;
      case 23 /* RingProgress */:
        result = buildRingProgress(W, H, onBack, state, setState, rendererRef, palette);
        break;
      default:
        result = buildButtons(W, H, onBack, palette, onButtonTap);
        break;
    }
    const isSettings = dest === 20 /* Settings */;
    const hideOverlays = state.hideOverlayButtons && !isSettings;
    const backIdx = result.elements.findIndex((e) => e.id === "__back__");
    if (backIdx >= 0) {
      if (hideOverlays) {
        result.elements.splice(backIdx, 1);
        delete result.interactions["__back__"];
      } else {
        const [backEl] = result.elements.splice(backIdx, 1);
        result.elements.push(backEl);
      }
    }
    if (onToggleTheme && !hideOverlays) {
      const themeBtn = gooseThemeBtn(onToggleTheme, palette, isLightTheme, W, false);
      if (state.globalSeparableBlur) {
        themeBtn.element.useSeparableBlur = true;
      }
      result.elements.push(themeBtn.element);
      result.interactions[themeBtn.element.id] = themeBtn.interaction;
    }
    if (onPickImage && dest !== 0 /* Home */) {
      const pickLabel = "Pick an image";
      const pickH = 56 * gooseDP2;
      const pickFontPx = 16;
      const pickW = Math.ceil(gooseTextW(pickLabel, pickFontPx) + 2 * (16 * gooseDP2 + 8 * gooseDP2));
      const pickBtn = gooseBtn(
        "__pickimage__",
        { x: W / 2 - pickW / 2, y: H - 16 - pickH, w: pickW, h: pickH },
        {
          label: pickLabel,
          tintColor: [0 / 255, 136 / 255, 255 / 255, 1],
          // accentColor（蓝色）
          surfaceColor: [0, 0, 0, 0],
          labelColor: [1, 1, 1, 1],
          // 白色文字
          labelFontSizePx: pickFontPx
        },
        false
        // scroll = false（固定在底部）
      );
      result.elements.push(pickBtn);
      result.interactions["__pickimage__"] = {
        onTap: () => onPickImage(),
        onDragStart: () => {
        },
        onDrag: () => {
        },
        onDragEnd: () => {
        }
      };
    }
    if (state.globalSeparableBlur) {
      for (const el of result.elements) {
        if ((el.kind === "button" || el.kind === "glass-shape") && !el.isSdfTexture && !el.isToggleKnob && !el.isBottomTabIndicator && !el.isMagnifier) {
          el.useSeparableBlur = true;
        }
      }
    }
    return result;
  }

  // src-bundle/liquid-glass.ts
  var MODE_MAP = {
    buttons: 1 /* Buttons */,
    toggle: 2 /* Toggle */,
    slider: 4 /* Slider */,
    "single-slider": 5 /* SingleSlider */,
    "single-toggle": 3 /* SingleToggle */,
    "bottom-tabs": 6 /* BottomTabs */,
    "single-bottom-tabs": 7 /* SingleBottomTabs */,
    "toggle-card": 8 /* ToggleCard */,
    "slider-card": 9 /* SliderCard */,
    "bottom-tabs-2": 10 /* BottomTabs2 */,
    dialog: 11 /* Dialog */,
    magnifier: 14 /* Magnifier */,
    "scroll-container": 18 /* ScrollContainer */,
    "lazy-scroll-container": 19 /* LazyScrollContainer */,
    rating: 22 /* Rating */,
    "rating-card": 22 /* Rating */,
    "ring-progress": 23 /* RingProgress */,
    "ring-progress-card": 23 /* RingProgress */
  };
  var ENUM_TO_MODE = Object.fromEntries(
    Object.entries(MODE_MAP).map(([k, v]) => [v, k])
  );
  function genGradient(isLight, w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(2, w | 0);
    c.height = Math.max(2, h | 0);
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    if (isLight) {
      g.addColorStop(0, "#3f6fd6");
      g.addColorStop(0.45, "#7b5cff");
      g.addColorStop(1, "#c44ad6");
    } else {
      g.addColorStop(0, "#0a1230");
      g.addColorStop(0.5, "#141a3a");
      g.addColorStop(1, "#2a1240");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    return c.toDataURL();
  }
  var LiquidGlass = class extends HTMLElement {
    // 进入 dialog 前的视图，点弹窗按钮后回退用
    constructor() {
      super();
      __publicField(this, "_canvas");
      __publicField(this, "_renderer", null);
      __publicField(this, "_state");
      __publicField(this, "_elements", []);
      __publicField(this, "_interactions", {});
      __publicField(this, "_gestures", /* @__PURE__ */ new Map());
      __publicField(this, "_prevPinch", null);
      __publicField(this, "_w", 0);
      __publicField(this, "_h", 0);
      __publicField(this, "_dark", false);
      __publicField(this, "_ro", null);
      __publicField(this, "_disposed", false);
      __publicField(this, "_gradientLoaded", false);
      __publicField(this, "_onWheel");
      __publicField(this, "_dbg", null);
      __publicField(this, "_tabsConfig", null);
      __publicField(this, "_buttonsConfig", null);
      __publicField(this, "_dialogConfig", null);
      __publicField(this, "_scrollConfig", null);
      __publicField(this, "_prevMode", "bottom-tabs");
      __publicField(this, "_onNavigate", (d) => {
        var _a;
        const name = (_a = ENUM_TO_MODE[d]) != null ? _a : "dest:" + d;
        this.dispatchEvent(new CustomEvent("lg-navigate", { detail: { dest: d, name }, bubbles: true }));
      });
      __publicField(this, "_onBack", () => {
        this.dispatchEvent(new CustomEvent("lg-back", { bubbles: true }));
      });
      __publicField(this, "_onButtonTap", (id) => {
        this.dispatchEvent(new CustomEvent("lg-buttontap", { detail: { id }, bubbles: true }));
      });
      __publicField(this, "_onDialogTap", (action) => {
        this.dispatchEvent(new CustomEvent("lg-dialogtap", { detail: { action }, bubbles: true }));
        this.setAttribute("mode", this._prevMode || "bottom-tabs");
        this._onBack();
      });
      __publicField(this, "_onLinkTap", (index, href) => {
        this.dispatchEvent(new CustomEvent("lg-linktap", { detail: { index, href }, bubbles: true }));
      });
      __publicField(this, "_onToggleTheme", () => {
        var _a;
        this._dark = !this._dark;
        (_a = this._renderer) == null ? void 0 : _a.gooseBG(this._mode() === 0 /* Home */ ? [0, 0, 0] : null);
        this._gradientLoaded = false;
        this._maybeLoadGradient();
        this._emitState();
        this._rebuild();
      });
      __publicField(this, "_onDown", (e) => {
        var _a, _b, _c, _d, _e, _f;
        const renderer = this._renderer;
        if (!renderer) return;
        const { x, y } = this._localPos(e);
        const scrollY = renderer.gooseGetScrollY();
        const els = this._elements;
        const interactions = this._interactions;
        let hit = null;
        for (let i = els.length - 1; i >= 0; i--) {
          const el = els[i];
          const hr = (_a = el.hitRect) != null ? _a : el.rect;
          const visibleHY = el.scroll ? hr.y - scrollY : hr.y;
          let testX = x;
          let testY = y;
          const elRot = el.elementRotation;
          if (elRot && Math.abs(elRot) > 1e-3) {
            const cx = hr.x + hr.w * 0.5;
            const cy = (el.scroll ? hr.y - scrollY : hr.y) + hr.h * 0.5;
            const dx = x - cx;
            const dy = y - cy;
            const cos = Math.cos(-elRot);
            const sin = Math.sin(-elRot);
            testX = cx + dx * cos - dy * sin;
            testY = cy + dx * sin + dy * cos;
          }
          if (testX >= hr.x && testX <= hr.x + hr.w && testY >= visibleHY && testY <= visibleHY + hr.h) {
            const hasInteraction = !!(interactions == null ? void 0 : interactions[el.id]);
            if (!hasInteraction && !el.isInteractive) continue;
            hit = el;
            break;
          }
        }
        if (hit) {
          const hitId = hit.id;
          const existingEntry = Array.from(this._gestures.entries()).find(
            ([, g]) => g.pressedId === hitId && g.mode !== "transform"
          );
          if (existingEntry && ((_b = interactions == null ? void 0 : interactions[hitId]) == null ? void 0 : _b.onTransform)) {
            const [partnerPid, partnerGs] = existingEntry;
            if (hit.isInteractive && (hit.kind === "button" || hit.kind === "text")) {
              renderer.goosePress(hitId, false);
            }
            const p1 = { x: partnerGs.x, y: partnerGs.y };
            const p2 = { x, y };
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            this._prevPinch = {
              dist: Math.hypot(dx, dy),
              angle: Math.atan2(dy, dx),
              cx: (p1.x + p2.x) / 2,
              cy: (p1.y + p2.y) / 2
            };
            partnerGs.mode = "transform";
            partnerGs.transformPartner = e.pointerId;
            this._gestures.set(e.pointerId, {
              pressedId: hitId,
              startX: x,
              startY: y,
              startClientY: e.clientY,
              startScrollY: renderer.gooseGetScrollY(),
              dragStarted: false,
              mode: "transform",
              hasDrag: !!((_c = interactions == null ? void 0 : interactions[hitId]) == null ? void 0 : _c.onDrag),
              velocitySamples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
              x,
              y,
              transformPartner: partnerPid
            });
            try {
              this._canvas.setPointerCapture(e.pointerId);
            } catch {
            }
            return;
          }
        }
        const hasDrag = !!(hit && ((_d = interactions == null ? void 0 : interactions[hit.id]) == null ? void 0 : _d.onDrag));
        if (!this._dbg) this._dbg = {};
        if (!this._dbg.downOnce) {
          this._dbg.downOnce = true;
          console.log("[lg-debug] down hitId=", hit == null ? void 0 : hit.id, "hasDrag=", hasDrag);
        }
        this._gestures.set(e.pointerId, {
          pressedId: hit ? hit.id : null,
          startX: x,
          startY: y,
          startClientY: e.clientY,
          startScrollY: renderer.gooseGetScrollY(),
          dragStarted: false,
          mode: "pending",
          hasDrag,
          velocitySamples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
          x,
          y,
          transformPartner: null
        });
        if (hit && hit.isInteractive) {
          const hasDrag0 = !!((_e = interactions == null ? void 0 : interactions[hit.id]) == null ? void 0 : _e.onDrag);
          if (hit.kind === "button" || hit.kind === "text" || hit.kind === "glass-shape" && !hasDrag0 && !!((_f = interactions == null ? void 0 : interactions[hit.id]) == null ? void 0 : _f.onTap)) {
            renderer.goosePress(hit.id, true, { x, y });
          }
        }
        try {
          this._canvas.setPointerCapture(e.pointerId);
        } catch {
        }
        window.addEventListener("pointermove", this._onMove);
        window.addEventListener("pointerup", this._onUp);
        window.addEventListener("pointercancel", this._onUp);
      });
      __publicField(this, "_onMove", (e) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
        const renderer = this._renderer;
        if (!renderer) return;
        const { x, y } = this._localPos(e);
        const gs = this._gestures.get(e.pointerId);
        if (!gs) return;
        gs.x = x;
        gs.y = y;
        if (gs.mode === "transform") {
          const partnerPid = gs.transformPartner;
          if (partnerPid == null) return;
          const partner = this._gestures.get(partnerPid);
          if (!partner) return;
          const id = gs.pressedId;
          if (!id) return;
          const dx2 = partner.x - gs.x;
          const dy2 = partner.y - gs.y;
          const dist = Math.hypot(dx2, dy2);
          const angle = Math.atan2(dy2, dx2);
          const cx = (gs.x + partner.x) / 2;
          const cy = (gs.y + partner.y) / 2;
          const prev = this._prevPinch;
          if (prev && prev.dist > 1e-3) {
            const gestureZoom = dist / prev.dist;
            let gestureRotate = angle - prev.angle;
            if (gestureRotate > Math.PI) gestureRotate -= 2 * Math.PI;
            if (gestureRotate < -Math.PI) gestureRotate += 2 * Math.PI;
            const pan = { x: cx - prev.cx, y: cy - prev.cy };
            (_c = (_b = (_a = this._interactions) == null ? void 0 : _a[id]) == null ? void 0 : _b.onTransform) == null ? void 0 : _c.call(_b, pan, gestureZoom, gestureRotate);
          }
          this._prevPinch = { dist, angle, cx, cy };
          return;
        }
        gs.velocitySamples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
        if (gs.velocitySamples.length > 20) gs.velocitySamples.shift();
        const dx = x - gs.startX;
        const dy = y - gs.startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (gs.mode === "pending") {
          const MOVE_THRESHOLD = 4;
          const id0 = gs.pressedId;
          if (id0) {
            const el0 = this._elements.find((b) => b.id === id0);
            if ((el0 == null ? void 0 : el0.kind) === "button" && el0.isInteractive) {
              renderer.gooseDragPos(id0, { x, y });
            }
          }
          if (absDx < MOVE_THRESHOLD && absDy < MOVE_THRESHOLD) return;
          const id = gs.pressedId;
          const hitEl = id ? this._elements.find((b) => b.id === id) : null;
          const isButton = (hitEl == null ? void 0 : hitEl.kind) === "button" && (hitEl == null ? void 0 : hitEl.isInteractive);
          const hasDrag = !!hitEl && !!((_e = (_d = this._interactions) == null ? void 0 : _d[id]) == null ? void 0 : _e.onDrag);
          if (hasDrag && !((_f = this._dbg) == null ? void 0 : _f.dragOnce)) {
            this._dbg = this._dbg || {};
            this._dbg.dragOnce = true;
            console.log("[lg-debug] pending\u2192drag id=", id, "onDragType=", typeof ((_h = (_g = this._interactions) == null ? void 0 : _g[id]) == null ? void 0 : _h.onDrag));
          }
          const isShapeButton = !hasDrag && (hitEl == null ? void 0 : hitEl.kind) === "glass-shape" && (hitEl == null ? void 0 : hitEl.isInteractive) && !!((_j = (_i = this._interactions) == null ? void 0 : _i[id]) == null ? void 0 : _j.onTap);
          if (hasDrag) {
            gs.mode = "drag";
            gs.dragStarted = true;
            (_m = (_l = (_k = this._interactions) == null ? void 0 : _k[id]) == null ? void 0 : _l.onDragStart) == null ? void 0 : _m.call(_l, { x, y });
          } else if (isButton || isShapeButton) {
            renderer.gooseDragPos(id, { x, y });
          } else {
            const SCROLL_TAKEOVER_THRESHOLD = 14;
            const verticalDominant = absDy > absDx + 2 && absDy >= SCROLL_TAKEOVER_THRESHOLD;
            if (verticalDominant) {
              const otherScrolling = Array.from(this._gestures.entries()).some(
                ([pid, g]) => pid !== e.pointerId && g.mode === "scroll"
              );
              if (otherScrolling) return;
              if (id) {
                const el = this._elements.find((b) => b.id === id);
                if ((el == null ? void 0 : el.isInteractive) && el.kind === "text") renderer.goosePress(id, false);
              }
              gs.mode = "scroll";
              const scrollDelta = e.clientY - gs.startClientY;
              renderer.gooseScrollY(gs.startScrollY - scrollDelta);
              return;
            }
          }
        }
        if (gs.mode === "scroll") {
          const scrollDelta = e.clientY - gs.startClientY;
          renderer.gooseScrollY(gs.startScrollY - scrollDelta);
          return;
        }
        if (gs.mode === "drag") {
          const id = gs.pressedId;
          if (!id) return;
          const el = this._elements.find((b) => b.id === id);
          if (!el) return;
          if (el.kind === "button" && el.isInteractive) renderer.gooseDragPos(id, { x, y });
          (_p = (_o = (_n = this._interactions) == null ? void 0 : _n[id]) == null ? void 0 : _o.onDrag) == null ? void 0 : _p.call(_o, { x, y }, { x: dx, y: dy });
        }
      });
      __publicField(this, "_onUp", (e) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
        const renderer = this._renderer;
        const gs = this._gestures.get(e.pointerId);
        if (!gs) {
          window.removeEventListener("pointermove", this._onMove);
          window.removeEventListener("pointerup", this._onUp);
          window.removeEventListener("pointercancel", this._onUp);
          if (this._canvas.hasPointerCapture(e.pointerId)) {
            try {
              this._canvas.releasePointerCapture(e.pointerId);
            } catch {
            }
          }
          return;
        }
        const mode = gs.mode;
        const id = gs.pressedId;
        if (mode === "transform") {
          const partnerPid = gs.transformPartner;
          this._gestures.delete(e.pointerId);
          this._prevPinch = null;
          if (partnerPid != null) {
            const partner = this._gestures.get(partnerPid);
            if (partner) {
              partner.transformPartner = null;
              partner.mode = "drag";
              partner.dragStarted = true;
              partner.startX = partner.x;
              partner.startY = partner.y;
              if (partner.pressedId) {
                (_c = (_b = (_a = this._interactions) == null ? void 0 : _a[partner.pressedId]) == null ? void 0 : _b.onDragStart) == null ? void 0 : _c.call(_b, { x: partner.x, y: partner.y });
              }
            }
          }
          if (this._canvas.hasPointerCapture(e.pointerId)) {
            try {
              this._canvas.releasePointerCapture(e.pointerId);
            } catch {
            }
          }
          return;
        }
        if (renderer) {
          if (id) {
            const el = this._elements.find((b) => b.id === id);
            if (el == null ? void 0 : el.isInteractive) {
              const hasDrag1 = !!((_e = (_d = this._interactions) == null ? void 0 : _d[id]) == null ? void 0 : _e.onDrag);
              if (el.kind === "button" || el.kind === "text" || el.kind === "glass-shape" && !hasDrag1 && !!((_g = (_f = this._interactions) == null ? void 0 : _f[id]) == null ? void 0 : _g.onTap)) {
                renderer.goosePress(id, false);
              }
            }
          }
          if (mode === "scroll") {
            const v = this._computeReleaseVelocity(gs.velocitySamples);
            if (Math.abs(v) > 50) renderer.gooseScrollV(v);
          }
          if (id) {
            const { x, y } = this._localPos(e);
            if (gs.dragStarted) {
              const { x: vx, y: vy } = this._computeReleaseVelocity2D(gs.velocitySamples);
              (_j = (_i = (_h = this._interactions) == null ? void 0 : _h[id]) == null ? void 0 : _i.onDragEnd) == null ? void 0 : _j.call(_i, { x, y }, { x: vx, y: vy });
            } else if (mode === "pending" || mode === "drag") {
              (_m = (_l = (_k = this._interactions) == null ? void 0 : _k[id]) == null ? void 0 : _l.onTap) == null ? void 0 : _m.call(_l, { x, y });
            }
          }
        }
        window.removeEventListener("pointermove", this._onMove);
        window.removeEventListener("pointerup", this._onUp);
        window.removeEventListener("pointercancel", this._onUp);
        this._gestures.delete(e.pointerId);
        if (this._canvas.hasPointerCapture(e.pointerId)) {
          try {
            this._canvas.releasePointerCapture(e.pointerId);
          } catch {
          }
        }
      });
      this._state = { ...gooseDefState };
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = ":host{position:relative;display:block;overflow:hidden;}canvas{display:block;width:100%;height:100%;touch-action:none;cursor:pointer;}";
      this._canvas = document.createElement("canvas");
      shadow.appendChild(style);
      shadow.appendChild(this._canvas);
    }
    static get observedAttributes() {
      return ["mode", "dark", "wallpaper", "clock-sdf", "dpr", "corner-style", "blur-tap-cap", "overlay-buttons", "theme-button", "tabs", "buttons", "dialog", "scroll"];
    }
    connectedCallback() {
      if (this._renderer) return;
      this._dark = this.hasAttribute("dark");
      const overlayButtons = this.hasAttribute("overlay-buttons");
      this._showThemeButton = this.hasAttribute("theme-button");
      this._state = { ...gooseDefState, hideOverlayButtons: !overlayButtons };
      const renderer = new LiquidGlassRenderer(this._canvas);
      this._renderer = renderer;
      const dprAttr = this.getAttribute("dpr");
      if (dprAttr != null) {
        const dv = parseFloat(dprAttr);
        const deviceDpr = window.devicePixelRatio || 1;
        renderer.dpr = dv > 0 ? Math.max(0.5, Math.min(deviceDpr, dv)) : deviceDpr;
      }
      const tapCap = this.getAttribute("blur-tap-cap");
      if (tapCap != null) renderer.blurTapCap = Math.max(1, Math.min(33, parseInt(tapCap) || 17));
      const corner = this.getAttribute("corner-style");
      if (corner != null) renderer.cornerStyle = parseFloat(corner);
      const mode = this._mode();
      renderer.gooseBG(mode === 0 /* Home */ ? [0, 0, 0] : null);
      const wp = this.getAttribute("wallpaper");
      if (wp && wp !== "gradient") {
        renderer.gooseLoadWP(wp).catch((e) => console.warn("[liquid-glass] wallpaper load failed:", e));
      }
      const sdf = this.getAttribute("clock-sdf");
      if (sdf) renderer.gooseLoadSDF(sdf).catch((e) => console.warn("[liquid-glass] sdf load failed:", e));
      const ro = new ResizeObserver(() => this._resize());
      ro.observe(this);
      this._ro = ro;
      this._onWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        renderer.gooseScrollY(renderer.gooseGetScrollY() + delta);
      };
      this._canvas.addEventListener("wheel", this._onWheel, { passive: false });
      this._canvas.addEventListener("pointerdown", this._onDown);
      this._resize();
      this._emitState();
    }
    disconnectedCallback() {
      this._disposed = true;
      if (this._ro) this._ro.disconnect();
      if (this._canvas) {
        this._canvas.removeEventListener("wheel", this._onWheel);
        this._canvas.removeEventListener("pointerdown", this._onDown);
        this._canvas.removeEventListener("pointermove", this._onMove);
        this._canvas.removeEventListener("pointerup", this._onUp);
        this._canvas.removeEventListener("pointerleave", this._onUp);
        this._canvas.removeEventListener("pointercancel", this._onUp);
      }
      if (this._renderer) {
        this._renderer.gooseKill();
        this._renderer = null;
      }
    }
    attributeChangedCallback(name, _old, val) {
      if (!this._renderer) return;
      const r = this._renderer;
      if (name === "mode") {
        const oldM = (_old || "bottom-tabs").toLowerCase();
        if (oldM !== "dialog") this._prevMode = oldM;
        r.gooseScrollY(0);
        this._rebuild();
      } else if (name === "dark") {
        this._dark = this.hasAttribute("dark");
        r.gooseBG(this._mode() === 0 /* Home */ ? [0, 0, 0] : null);
        this._gradientLoaded = false;
        this._maybeLoadGradient();
        this._rebuild();
        this._emitState();
      } else if (name === "wallpaper") {
        this._gradientLoaded = false;
        if (val && val !== "gradient") r.gooseLoadWP(val).catch(() => {
        });
        else this._maybeLoadGradient();
      } else if (name === "clock-sdf") {
        if (val) r.gooseLoadSDF(val).catch(() => {
        });
      } else if (name === "dpr") {
        const dv = parseFloat(val || "0");
        const deviceDpr = window.devicePixelRatio || 1;
        r.dpr = dv > 0 ? Math.max(0.5, Math.min(deviceDpr, dv)) : deviceDpr;
        this._resize();
      } else if (name === "corner-style") {
        if (val != null) {
          r.cornerStyle = parseFloat(val);
          r.gooseReqRender();
        }
      } else if (name === "blur-tap-cap") {
        if (val != null) {
          r.blurTapCap = Math.max(1, Math.min(33, parseInt(val) || 17));
          r.gooseReqRender();
        }
      } else if (name === "overlay-buttons") {
        this._state = { ...this._state, hideOverlayButtons: !this.hasAttribute("overlay-buttons") };
        this._rebuild();
        this._emitState();
      } else if (name === "theme-button") {
        this._showThemeButton = this.hasAttribute("theme-button");
        this._rebuild();
        this._emitState();
      } else if (name === "tabs") {
        if (val) {
          try {
            this._tabsConfig = JSON.parse(val);
          } catch {
            this._tabsConfig = null;
          }
        } else {
          this._tabsConfig = null;
        }
        this._rebuild();
      } else if (name === "buttons") {
        if (val) {
          try {
            this._buttonsConfig = JSON.parse(val);
          } catch {
            this._buttonsConfig = null;
          }
        } else {
          this._buttonsConfig = null;
        }
        this._rebuild();
      } else if (name === "dialog") {
        if (val) {
          try {
            this._dialogConfig = JSON.parse(val);
          } catch {
            this._dialogConfig = null;
          }
        } else {
          this._dialogConfig = null;
        }
        this._rebuild();
      } else if (name === "scroll") {
        if (val) {
          try {
            this._scrollConfig = JSON.parse(val);
          } catch {
            this._scrollConfig = null;
          }
        } else {
          this._scrollConfig = null;
        }
        this._rebuild();
      }
    }
    _mode() {
      var _a;
      const m = (this.getAttribute("mode") || "bottom-tabs").toLowerCase();
      return (_a = MODE_MAP[m]) != null ? _a : 6 /* BottomTabs */;
    }
    _maybeLoadGradient() {
      var _a, _b;
      const wp = this.getAttribute("wallpaper");
      if (this._w <= 0 || this._gradientLoaded) return;
      if (wp === "gradient") {
        this._gradientLoaded = true;
        (_a = this._renderer) == null ? void 0 : _a.gooseLoadWP(genGradient(!this._dark, this._w, this._h)).catch(() => {
        });
      } else if (!wp) {
        this._gradientLoaded = true;
        const tc = document.createElement("canvas");
        tc.width = Math.max(2, this._w | 0);
        tc.height = Math.max(2, this._h | 0);
        (_b = this._renderer) == null ? void 0 : _b.gooseLoadWP(tc.toDataURL()).catch(() => {
        });
      }
    }
    _resize() {
      var _a;
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this._w = r.width;
      this._h = r.height;
      this._canvas.style.width = r.width + "px";
      this._canvas.style.height = r.height + "px";
      (_a = this._renderer) == null ? void 0 : _a.gooseResize(r.width, r.height);
      this._maybeLoadGradient();
      this._rebuild();
    }
    _emitState() {
      this.dispatchEvent(
        new CustomEvent("lg-statechange", {
          detail: { ...this._state, dark: this._dark },
          bubbles: true
        })
      );
    }
    _setState(patch) {
      const next = typeof patch === "function" ? patch(this._state) : patch;
      this._state = { ...this._state, ...next };
      this._emitState();
      this._rebuild();
    }
    /** 直接设置组件状态（供外部调用，如 setState({ ratingValue: 3 })）。 */
    setState(patch) {
      this._setState(patch);
    }
    /** 配置底部标签栏内容：[[{icon,label}...],[{icon,label}...]]（两组，可只传一组）。icon 为 SVG path 字符串。 */
    setTabs(config) {
      this._tabsConfig = config;
      this._rebuild();
    }
    /** 配置按钮组：[{id?, label?, style?}]，每个按钮独立（文字 + 样式）。style: 'transparent'|'surface'|'blue'|'orange' 或自定义 rgba 色。 */
    gooseButtons(config) {
      this._buttonsConfig = config;
      this._rebuild();
    }
    /** 配置弹窗内容：{ title?, body?, cancelText?, okayText? }。不传则回退原版默认文案。 */
    setDialog(config) {
      this._dialogConfig = config;
      this._rebuild();
    }
    /** 配置滚动容器列表项：[{ title, subtitle? }]。不传则回退原版空卡片。 */
    setScroll(config) {
      this._scrollConfig = config;
      this._rebuild();
    }
    _rebuild() {
      if (!this._renderer || this._disposed) return;
      const W = this._w;
      const H = this._h;
      if (!W || !H) return;
      const dest = this._mode();
      const result = gooseBuild(
        dest,
        W,
        H,
        this._state,
        (p) => this._setState(p),
        this._onNavigate,
        this._onBack,
        this._renderer ? { current: this._renderer } : void 0,
        !this._dark,
        this.hasAttribute("overlay-buttons") || this.hasAttribute("theme-button") ? this._onToggleTheme : void 0,
        void 0,
        this._onButtonTap,
        this._tabsConfig,
        this._buttonsConfig,
        this._dialogConfig,
        this._onDialogTap,
        this._scrollConfig,
        this._onLinkTap
      );
      this._elements = result.elements;
      this._interactions = result.interactions;
      this._renderer.gooseElements(this._elements);
      this._renderer.gooseContentH(result.contentHeight);
      this._renderer.gooseReqRender();
      this._syncTargets();
    }
    // Faithful port of context.tsx's toggleTargets/tabTargets useEffect sync.
    _syncTargets() {
      const r = this._renderer;
      if (!r) return;
      const sync = (id, fn) => {
        if (gooseDragGroups.has(id)) return;
        try {
          fn();
        } catch {
        }
      };
      sync("toggle1", () => r.gooseTglTarget("toggle1", this._state.toggleOn ? 1 : 0));
      sync("toggle2", () => r.gooseTglTarget("toggle2", this._state.toggleOn ? 1 : 0));
      sync("tabs3", () => {
        var _a, _b, _c;
        return r.gooseTabSel("tabs3", this._state.selectedTab, (_c = (_b = (_a = this._tabsConfig) == null ? void 0 : _a[0]) == null ? void 0 : _b.length) != null ? _c : 3);
      });
      sync("tabs4", () => {
        var _a, _b, _c;
        return r.gooseTabSel("tabs4", this._state.selectedTab2, (_c = (_b = (_a = this._tabsConfig) == null ? void 0 : _a[1]) == null ? void 0 : _b.length) != null ? _c : 4);
      });
      sync("slider1", () => r.gooseTglTarget("slider1", this._state.sliderValue / 100));
      sync("slider2", () => r.gooseTglTarget("slider2", this._state.sliderValue / 100));
    }
    // ---- pointer gesture system (faithful port of context.tsx) ----
    _localPos(e) {
      const rect = this._canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    _computeReleaseVelocity(samples) {
      if (samples.length < 2) return 0;
      const now = samples[samples.length - 1].t;
      const cutoff = now - 100;
      let oldest = samples[samples.length - 1];
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i].t < cutoff) break;
        oldest = samples[i];
      }
      const dt = (now - oldest.t) / 1e3;
      if (dt < 1e-3) return 0;
      const dy = samples[samples.length - 1].y - oldest.y;
      return -dy / dt;
    }
    _computeReleaseVelocity2D(samples) {
      if (samples.length < 2) return { x: 0, y: 0 };
      const last = samples[samples.length - 1];
      const now = last.t;
      const cutoff = now - 100;
      let oldest = last;
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i].t < cutoff) break;
        oldest = samples[i];
      }
      const dt = (now - oldest.t) / 1e3;
      if (dt < 1e-3) return { x: 0, y: 0 };
      return { x: (last.x - oldest.x) / dt, y: (last.y - oldest.y) / dt };
    }
  };
  customElements.define("liquid-glass", LiquidGlass);
})();
