(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,65879,e=>{"use strict";var t=e.i(68834),r=e.i(79473);let i=(0,t.create)()((0,r.subscribeWithSelector)((e,t)=>({projects:[],currentIndex:0,currentProject:null,setCurrentProjectIndex:r=>{e({currentIndex:r,currentProject:t().projects[r]||null})},getCurrentProject(){let{projects:e,currentIndex:r}=t();return e[r]||null},setProjects:r=>{0===t().projects.length&&e({projects:r})}})));e.s(["useProjects",0,i])},70321,e=>{"use strict";var t,r,i,u,o=e.i(38232),a=e.i(15907),s=e.i(15010),n=e.i(88171),l=e.i(75056),c=e.i(61786),f=e.i(31067),v=e.i(90072);let h=s.forwardRef(({args:e,children:t,...r},i)=>{let u=s.useRef(null);return s.useImperativeHandle(i,()=>u.current),s.useLayoutEffect(()=>void 0),s.createElement("mesh",(0,f.default)({ref:u},r),s.createElement("planeGeometry",{attach:"geometry",args:e}),t)});var d=v,g=e.i(58013),m=e.i(71753),p=e.i(28593),P=e.i(89970),x=e.i(65747),T=e.i(65879);let y=(0,e.i(68834).create)(e=>({textures:new Map,setTextures:(t,r)=>e(e=>{let i=new Map(e.textures);return i.set(t,r),{textures:i}}),clearTextures:()=>e(e=>(e.textures.forEach(e=>{e.forEach(e=>e.dispose())}),{textures:new Map}))}));var w=e.i(35166);P.default.registerPlugin(x.useGSAP);let R=(t={uTime:0,uPicture:null,uPreviousPicture:null,uPictureRatio:1,uPreviousPictureRatio:1,uViewportRatio:1,uPlaneRatio:1,uSide:0,uProgress:0,uDelayOpacity:0},r=`
	varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,i=`
    uniform float uTime;
    uniform float uSide;
    uniform float uProgress;
    uniform float uPictureRatio;
    uniform float uPreviousPictureRatio;
    uniform float uViewportRatio;
    uniform float uPlaneRatio;
    uniform float uDelayOpacity;
    uniform sampler2D uPicture;
    uniform sampler2D uPreviousPicture;

    varying vec2 vUv;

    // 2D Random
    float random (vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.563123);
    }

    // 2D Noise
    float noise (in vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);

        // Four corners in 2D of a tile
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));

        vec2 u = f * f * (3.0 - 2.0 * f);

        return mix(a, b, u.x) +
                (c - a)* u.y * (1.0 - u.x) +
                (d - b) * u.x * u.y;
    }

    vec2 getCoverUv(vec2 uv, float imageRatio, float planeRatio) {
        vec2 scale = vec2(1.0);
        if (imageRatio > planeRatio) {
            scale.x = planeRatio / imageRatio;
        } else {
            scale.y = imageRatio / planeRatio;
        }
        return (uv - 0.5) * scale + 0.5;
    }

    void main() {
        vec2 uv = getCoverUv(vUv, uPictureRatio, uPlaneRatio);
        vec2 prevUv = getCoverUv(vUv, uPreviousPictureRatio, uPlaneRatio);

        uv = clamp(uv, 0.0, 1.0);
        prevUv = clamp(prevUv, 0.0, 1.0);

        vec2 centeredUv = vUv - vec2(0.5);
        float angle = atan(centeredUv.y, centeredUv.x);
        float radius = length(centeredUv);

        // Base sine waves for shape
        float wave = sin(angle * 3.0 + uTime * 0.5) * 0.03;
        wave += sin(angle * 7.0 - uTime * 0.3) * 0.015;

        // Organic noise detail
        float variation = uSide > 0.5 ? 12.0 : 6.0;
        float n = noise(centeredUv * variation - uTime * 0.8);
        wave += (n - 0.5) * 0.05 * 1.0;

        float circle = 1.0 - smoothstep(0.2 + wave, 0.5 + wave, radius);

        vec4 texColor = texture2D(uPicture, uv);
        vec4 prevTexColor = texture2D(uPreviousPicture, prevUv);

		float transitionRadius = uProgress;
        float transitionMask = 1.0 - smoothstep(transitionRadius - 0.25, transitionRadius, radius + wave);

        vec3 color = mix(prevTexColor.rgb, texColor.rgb, transitionMask);
		color *= 0.8;

        gl_FragColor.rgba = vec4(color, circle * uDelayOpacity);
    }
  `,(u=class extends d.ShaderMaterial{constructor(e){for(const u in super({vertexShader:r,fragmentShader:i,...e}),t)this.uniforms[u]=new d.Uniform(t[u]),Object.defineProperty(this,u,{get(){return this.uniforms[u].value},set(e){this.uniforms[u].value=e}});this.uniforms=d.UniformsUtils.clone(this.uniforms)}}).key=d.MathUtils.generateUUID(),u);function j(){let e=(0,s.useRef)(null),t=(0,s.useRef)(null),r=(0,s.useRef)(null),{viewport:i,gl:u}=(0,p.useThree)(),a=(0,T.useProjects)(e=>e.projects),n=(0,T.useProjects)(e=>e.currentProject),{textures:l,setTextures:c,clearTextures:f}=y(),d=(0,w.useIsMobile)(),g=(0,s.useRef)({currentTextures:null,prevTextures:null,progress:1,isTransitioning:!1,delayOpacity:0}),R=(0,s.useRef)(new Set),j=(0,s.useMemo)(()=>i.aspect,[i.aspect]),U=(0,s.useMemo)(()=>{let e=i.width,t=i.height;return d?{left:{width:+e,height:.6*t},right:{width:.8*e,height:.5*t}}:{left:{width:.6*e,height:.7*t},right:{width:.6*e,height:.77*t}}},[i.width,i.height,d]),b=(0,s.useMemo)(()=>({left:U.left.width/U.left.height,right:U.right.width/U.right.height}),[U]),M=(0,s.useMemo)(()=>({left:[d?-(.15*i.width):-(.3*i.width),d?.2*i.height:.15*i.height,0],right:[.25*i.width,d?-(.2*i.height):-(.15*i.height),0]}),[i.width,i.height,d]);return(0,s.useEffect)(()=>{let e=R.current;return()=>{f(),e.clear()}},[f]),(()=>{let{gl:e}=(0,p.useThree)(),{textures:t}=y(),r=(0,T.useProjects)(e=>e.projects);(0,s.useEffect)(()=>{if(!r?.length||0===t.size)return;let i=new v.Scene,u=new v.OrthographicCamera(-1,1,1,-1,.1,1e3),o=new v.WebGLRenderTarget(64,64),a=0,s=[];try{r.forEach(r=>{let n=t.get(r.slug);n&&n.forEach(t=>{if(t)try{let r=new v.PlaneGeometry(2,2),s=new v.MeshBasicMaterial({map:t}),n=new v.Mesh(r,s);i.add(n),e.setRenderTarget(o),e.render(i,u),e.setRenderTarget(null),i.remove(n),s.dispose(),r.dispose(),a++}catch(e){e instanceof Error&&s.push(e)}})}),s.length>0&&console.warn(`⚠ Texture Preload: ${s.length} errors during preload`)}finally{o.dispose()}return()=>{try{o.dispose()}catch{}}},[r,t,e])})(),(0,s.useEffect)(()=>{if(a?.length)return a.forEach(e=>((e,t=!1)=>{let r=l.has(e.slug),i=R.current.has(e.slug);if(!r&&!i){R.current.add(e.slug);let t=new v.TextureLoader,r=[e.cover1?.responsiveImage?.src,e.cover2?.responsiveImage?.src],i=r.filter(Boolean).length,u=[],o=0;r.forEach((r,a)=>{r&&t.load(r,t=>{t.minFilter=v.LinearFilter,t.magFilter=v.LinearFilter,t.wrapS=t.wrapT=v.ClampToEdgeWrapping,t.generateMipmaps=!1,t.needsUpdate=!0,u[a]=t,++o===i&&(c(e.slug,u),R.current.delete(e.slug))},void 0,()=>{R.current.delete(e.slug)})})}})(e,!0)),()=>{}},[a,u,l,c]),(0,x.useGSAP)(()=>{let e=n?.slug||(a?.[0]?.slug??"");if(!e)return;let t=l.get(e),r=g.current;if(!r.currentTextures){t&&(r.currentTextures=t,r.prevTextures=t,r.progress=1,r.delayOpacity=0,setTimeout(()=>{P.default.to(r,{delayOpacity:1,duration:.4,ease:"power1.out"})},0));return}if(r.currentTextures===t)return;r.isTransitioning&&P.default.killTweensOf(r),r.isTransitioning=!0,r.prevTextures=r.currentTextures,t&&(r.currentTextures=t),r.progress=0;let i=setTimeout(()=>{P.default.to(r,{progress:1,duration:.8,ease:"power1.out",delay:.1,onComplete:()=>{r.isTransitioning=!1,t&&r.currentTextures!==t&&(r.currentTextures=t)}})},200);return()=>clearTimeout(i)},[n?.slug,l,a]),(0,m.useFrame)(e=>{let i=g.current,u=e.clock.elapsedTime;if(t.current&&i.currentTextures){let e=t.current;if(e.uniforms.uTime.value=u,e.uniforms.uProgress.value=i.progress,e.uniforms.uDelayOpacity.value=i.delayOpacity,e.uniforms.uViewportRatio.value=j,e.uniforms.uPlaneRatio.value=b.left,i.currentTextures[0]){e.uniforms.uPicture.value=i.currentTextures[0];let t=i.currentTextures[0].image;t&&(e.uniforms.uPictureRatio.value=t.width/t.height)}if(i.prevTextures?.[0]){e.uniforms.uPreviousPicture.value=i.prevTextures[0];let t=i.prevTextures[0].image;t&&(e.uniforms.uPreviousPictureRatio.value=t.width/t.height)}}if(r.current&&i.currentTextures){let e=r.current;if(e.uniforms.uTime.value=u,e.uniforms.uProgress.value=i.progress,e.uniforms.uDelayOpacity.value=i.delayOpacity,e.uniforms.uViewportRatio.value=j,e.uniforms.uPlaneRatio.value=b.right,i.currentTextures[1]){e.uniforms.uPicture.value=i.currentTextures[1];let t=i.currentTextures[1].image;t&&(e.uniforms.uPictureRatio.value=t.width/t.height)}if(i.prevTextures?.[1]){e.uniforms.uPreviousPicture.value=i.prevTextures[1];let t=i.prevTextures[1].image;t&&(e.uniforms.uPreviousPictureRatio.value=t.width/t.height)}}}),(0,o.jsxs)("group",{ref:e,children:[(0,o.jsx)(h,{args:[U.left.width,U.left.height],position:M.left,children:(0,o.jsx)("pictureMaterial",{ref:t,uSide:0,uPlaneRatio:b.left,uPicture:null,uPreviousPicture:null,uPictureRatio:1,uPreviousPictureRatio:1,uViewportRatio:j,uProgress:1,transparent:!0})}),(0,o.jsx)(h,{args:[U.right.width,U.right.height],position:M.right,children:(0,o.jsx)("pictureMaterial",{ref:r,uSide:1,uPlaneRatio:b.right,uPicture:null,uPreviousPicture:null,uPictureRatio:1,uPreviousPictureRatio:1,uViewportRatio:j,uProgress:1,transparent:!0})})]})}function U(){let e,t,r,i,u,n,f,v,h=(0,a.c)(10),[d,g]=(0,s.useState)(2);return h[0]===Symbol.for("react.memo_cache_sentinel")?(e={pointerEvents:"none",position:"absolute",top:0,left:0,width:"100%",height:"100vh",userSelect:"none",zIndex:10},h[0]=e):e=h[0],h[1]!==d?(t=[1,d],h[1]=d,h[2]=t):t=h[2],h[3]===Symbol.for("react.memo_cache_sentinel")?(r={toneMapping:0,preserveDrawingBuffer:!1,powerPreference:"high-performance",antialias:!0},i=(0,o.jsx)(j,{}),h[3]=r,h[4]=i):(r=h[3],i=h[4]),h[5]===Symbol.for("react.memo_cache_sentinel")?(u=()=>g(1),n=()=>g(2),h[5]=u,h[6]=n):(u=h[5],n=h[6]),h[7]===Symbol.for("react.memo_cache_sentinel")?(f=(0,o.jsx)(c.PerformanceMonitor,{onDecline:u,onIncline:n,flipflops:3,onFallback:()=>g(1)}),h[7]=f):f=h[7],h[8]!==t?(v=(0,o.jsxs)(l.Canvas,{className:"c-r3f-canvas-0 max-mobile:h-dvh!",style:e,dpr:t,gl:r,children:[i,f]}),h[8]=t,h[9]=v):v=h[9],v}(0,g.extend)({PictureMaterial:R});var b=e.i(72988);function M(e){let t,r,i,u,l=(0,a.c)(9),{children:c}=e,{isProjects:f}=(0,b.useRoute)(),[v,h]=(0,s.useState)(null);return l[0]!==v?(t=()=>{if(v)return;let e=document.getElementById("projects-r3f-portal-root");if(!e){(e=document.createElement("div")).id="projects-r3f-portal-root",e.style.position="fixed",e.style.top="0",e.style.left="0",e.style.width="100%",e.style.height="100dvh",e.style.pointerEvents="none",e.style.zIndex="3";let t=document.querySelector(".c-main");t?.appendChild(e)}(async()=>h(e))()},r=[v],l[0]=v,l[1]=t,l[2]=r):(t=l[1],r=l[2]),(0,s.useEffect)(t,r),l[3]!==f||l[4]!==v?(i=v&&(0,n.createPortal)((0,o.jsx)("div",{style:{display:f?"block":"none"},children:(0,o.jsx)(s.Suspense,{fallback:null,children:(0,o.jsx)(U,{})})}),v),l[3]=f,l[4]=v,l[5]=i):i=l[5],l[6]!==c||l[7]!==i?(u=(0,o.jsxs)(o.Fragment,{children:[c,i]}),l[6]=c,l[7]=i,l[8]=u):u=l[8],u}e.s(["default",()=>M],70321)}]);