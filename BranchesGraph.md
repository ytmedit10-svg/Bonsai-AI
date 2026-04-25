<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>ARCHIVE.AI - Branches</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com" rel="preconnect"/>
<link crossorigin="" href="https://fonts.gstatic.com" rel="preconnect"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&amp;family=Noto+Serif:ital,wght@0,400;0,700;1,400&amp;family=Space+Grotesk:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    "colors": {
                        "on-primary-container": "#00566a",
                        "primary": "#a5e7ff",
                        "surface-tint": "#47d6ff",
                        "surface": "#121414",
                        "surface-variant": "#343535",
                        "primary-container": "#00d2ff",
                        "on-tertiary-fixed": "#1c1b1b",
                        "surface-container": "#1e2020",
                        "on-error": "#690005",
                        "on-surface-variant": "#bbc9cf",
                        "tertiary-container": "#c3c0c0",
                        "tertiary-fixed": "#e5e2e1",
                        "outline-variant": "#3c494e",
                        "on-primary": "#003543",
                        "surface-container-lowest": "#0d0e0f",
                        "on-secondary-fixed-variant": "#474646",
                        "on-background": "#e3e2e2",
                        "background": "#121414",
                        "secondary-fixed-dim": "#c9c6c5",
                        "on-surface": "#e3e2e2",
                        "surface-bright": "#38393a",
                        "on-tertiary-fixed-variant": "#474746",
                        "secondary": "#c9c6c5",
                        "outline": "#859399",
                        "secondary-fixed": "#e5e2e1",
                        "on-error-container": "#ffdad6",
                        "error-container": "#93000a",
                        "on-secondary": "#313030",
                        "surface-dim": "#121414",
                        "on-secondary-fixed": "#1c1b1b",
                        "inverse-surface": "#e3e2e2",
                        "on-secondary-container": "#bab8b7",
                        "secondary-container": "#4a4949",
                        "inverse-primary": "#00677f",
                        "tertiary-fixed-dim": "#c8c6c5",
                        "inverse-on-surface": "#2f3131",
                        "surface-container-high": "#292a2a",
                        "error": "#ffb4ab",
                        "tertiary": "#dfdcdb",
                        "on-primary-fixed-variant": "#004e60",
                        "on-primary-fixed": "#001f28",
                        "on-tertiary-container": "#4f4e4e",
                        "surface-container-highest": "#343535",
                        "primary-fixed-dim": "#47d6ff",
                        "surface-container-low": "#1a1c1c",
                        "on-tertiary": "#313030",
                        "primary-fixed": "#b6ebff"
                    },
                    "borderRadius": {
                        "DEFAULT": "0.125rem",
                        "lg": "0.25rem",
                        "xl": "0.5rem",
                        "full": "0.75rem"
                    },
                    "spacing": {
                        "gutter": "24px",
                        "stack-md": "24px",
                        "stack-lg": "48px",
                        "unit": "4px",
                        "container-max": "1280px",
                        "margin-page": "64px",
                        "stack-sm": "12px"
                    },
                    "fontFamily": {
                        "headline-md": ["Noto Serif"],
                        "headline-lg": ["Noto Serif"],
                        "body-lg": ["Inter"],
                        "display-xl": ["Noto Serif"],
                        "label-caps": ["Space Grotesk"],
                        "body-md": ["Inter"]
                    },
                    "fontSize": {
                        "headline-md": ["1.75rem", { "lineHeight": "1.3", "fontWeight": "400" }],
                        "headline-lg": ["2.5rem", { "lineHeight": "1.2", "fontWeight": "400" }],
                        "body-lg": ["1.125rem", { "lineHeight": "1.7", "fontWeight": "400" }],
                        "display-xl": ["4.5rem", { "lineHeight": "1.1", "letterSpacing": "-0.02em", "fontWeight": "400" }],
                        "label-caps": ["0.75rem", { "lineHeight": "1.2", "letterSpacing": "0.1em", "fontWeight": "500" }],
                        "body-md": ["1rem", { "lineHeight": "1.6", "fontWeight": "400" }]
                    }
                }
            }
        }
    </script>
<style>
        body {
            background-color: #0a0a0a;
            color: #e3e2e2;
        }
        .glow-line {
            box-shadow: 0 0 15px rgba(0, 210, 255, 0.2);
        }
        .glow-node-active {
            box-shadow: 0 0 20px rgba(0, 210, 255, 0.6);
        }
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
    </style>
</head>
<body class="min-h-screen overflow-hidden flex font-body-md text-body-md">
<!-- TopAppBar -->
<header class="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-12 h-16 bg-[#0a0a0a] backdrop-blur-xl bg-opacity-80 border-b border-[#262626] transition-all duration-500 ease-in-out hidden md:flex">
<div class="flex items-center gap-4">
<span class="text-xl font-serif text-[#00d2ff] tracking-tighter">ARCHIVE.AI</span>
</div>
<div class="flex items-center gap-6">
<button class="flex items-center gap-2 border border-primary-container text-primary-container px-4 py-2 rounded-DEFAULT hover:bg-primary-container/5 hover:shadow-[0_0_15px_rgba(0,210,255,0.2)] transition-all">
<span class="font-label-caps text-label-caps">Export Path</span>
</button>
<div class="flex items-center gap-4">
<button class="text-neutral-500 hover:text-white transition-colors duration-300">
<span class="material-symbols-outlined">history</span>
</button>
<button class="text-neutral-500 hover:text-white transition-colors duration-300">
<span class="material-symbols-outlined">notifications</span>
</button>
</div>
</div>
</header>
<!-- SideNavBar -->
<nav class="fixed left-0 top-16 h-[calc(100vh-64px)] flex flex-col py-8 w-64 bg-[#0a0a0a] border-r border-[#262626] hidden md:flex z-40">
<div class="px-6 mb-8">
<h2 class="font-headline-md text-headline-md text-white mb-1">Project Alpha</h2>
<p class="font-label-caps text-label-caps text-neutral-500">V-4.2 Active</p>
</div>
<div class="flex flex-col gap-2 w-full">
<a class="flex items-center gap-4 py-3 text-neutral-600 pl-4 hover:text-neutral-200 hover:bg-neutral-900/50 transition-all duration-200 font-sans text-xs font-medium tracking-widest uppercase scale-98 active:scale-95" href="#">
<span class="material-symbols-outlined">account_tree</span>
<span>Timeline</span>
</a>
<a class="flex items-center gap-4 py-3 text-neutral-600 pl-4 hover:text-neutral-200 hover:bg-neutral-900/50 transition-all duration-200 font-sans text-xs font-medium tracking-widest uppercase scale-98 active:scale-95" href="#">
<span class="material-symbols-outlined">auto_stories</span>
<span>Library</span>
</a>
<a class="flex items-center gap-4 py-3 text-[#00d2ff] border-l-2 border-[#00d2ff] shadow-[0_0_10px_rgba(0,210,255,0.3)] bg-gradient-to-r from-[#00d2ff0d] to-transparent pl-4 hover:text-neutral-200 hover:bg-neutral-900/50 transition-all duration-200 font-sans text-xs font-medium tracking-widest uppercase scale-98 active:scale-95" href="#">
<span class="material-symbols-outlined" style="font-variation-settings: 'FILL' 1;">fork_right</span>
<span>Branches</span>
</a>
<a class="flex items-center gap-4 py-3 text-neutral-600 pl-4 hover:text-neutral-200 hover:bg-neutral-900/50 transition-all duration-200 font-sans text-xs font-medium tracking-widest uppercase scale-98 active:scale-95" href="#">
<span class="material-symbols-outlined">settings</span>
<span>Settings</span>
</a>
</div>
</nav>
<!-- Main Canvas -->
<main class="flex-1 ml-0 md:ml-64 mt-16 relative w-full h-[calc(100vh-64px)] overflow-hidden bg-[#0a0a0a]">
<!-- Graph Container -->
<div class="absolute inset-0 flex items-center justify-start overflow-x-auto overflow-y-hidden px-24 pb-24 pt-12">
<div class="relative w-[1500px] h-[600px] flex items-center">
<!-- Main Timeline Path -->
<div class="absolute w-full h-[2px] bg-[#262626] top-1/2 -translate-y-1/2">
<div class="h-full w-[65%] bg-primary-container glow-line rounded-full"></div>
</div>
<!-- Nodes and Branches -->
<!-- Node 1 (Genesis) -->
<div class="absolute left-0 top-1/2 -translate-y-1/2 flex flex-col items-center">
<div class="w-4 h-4 rounded-full bg-primary-container glow-line border-2 border-[#0a0a0a] z-10"></div>
<span class="absolute top-8 font-label-caps text-label-caps text-neutral-500 whitespace-nowrap">Genesis Query</span>
</div>
<!-- Node 2 (First Iteration) -->
<div class="absolute left-[200px] top-1/2 -translate-y-1/2 flex flex-col items-center">
<div class="w-5 h-5 rounded-full bg-primary-container glow-line border-2 border-[#0a0a0a] z-10"></div>
<span class="absolute bottom-8 font-label-caps text-label-caps text-neutral-400 whitespace-nowrap">Context Established</span>
</div>
<!-- Branch 1 (Up) -->
<svg class="absolute left-[200px] top-[150px] w-[300px] h-[150px] pointer-events-none" fill="none" viewbox="0 0 300 150">
<path d="M 0 150 C 100 150, 150 0, 300 0" stroke="#262626" stroke-width="2"></path>
</svg>
<div class="absolute left-[500px] top-[150px] -translate-y-1/2 flex flex-col items-center">
<div class="w-3 h-3 rounded-full bg-neutral-600 border-2 border-[#0a0a0a] z-10"></div>
<span class="absolute top-6 font-label-caps text-label-caps text-neutral-600 whitespace-nowrap">Creative Tangent</span>
</div>
<!-- Node 3 (Divergence) -->
<div class="absolute left-[400px] top-1/2 -translate-y-1/2 flex flex-col items-center">
<div class="w-6 h-6 rounded-full bg-[#0a0a0a] border-[3px] border-primary-container glow-line z-10 flex items-center justify-center">
<div class="w-1.5 h-1.5 rounded-full bg-primary-container"></div>
</div>
<span class="absolute top-10 font-headline-md text-headline-md text-white whitespace-nowrap">Analysis Phase</span>
</div>
<!-- Branch 2 (Down - Active) -->
<svg class="absolute left-[400px] top-[300px] w-[350px] h-[200px] pointer-events-none z-0" fill="none" viewbox="0 0 350 200">
<path d="M 0 0 C 150 0, 200 200, 350 200" filter="drop-shadow(0 0 6px rgba(0,210,255,0.4))" stroke="#00d2ff" stroke-width="2"></path>
</svg>
<!-- Active Node -->
<div class="absolute left-[750px] top-[500px] -translate-y-1/2 flex flex-col items-center z-20">
<div class="relative w-10 h-10 rounded-full bg-[#161616] border border-primary-container glow-node-active flex items-center justify-center cursor-pointer">
<div class="w-4 h-4 rounded-full bg-primary-container"></div>
<!-- Pulse effect -->
<div class="absolute inset-0 rounded-full border border-primary-container opacity-50 scale-150 animate-pulse"></div>
</div>
<div class="absolute top-14 flex flex-col items-center bg-[#161616] border border-[#262626] p-4 rounded-DEFAULT backdrop-blur-md w-64">
<h3 class="font-headline-md text-headline-md text-primary-container mb-2 text-center text-sm">Deep Synthesis</h3>
<p class="font-body-md text-body-md text-neutral-400 text-xs text-center">Synthesizing multiple archival sources into unified theory.</p>
<div class="mt-4 flex gap-2">
<span class="px-2 py-1 rounded bg-[#262626] font-label-caps text-label-caps text-neutral-300 text-[10px]">v4.2.1</span>
<span class="px-2 py-1 rounded border border-[#262626] font-label-caps text-label-caps text-primary-container text-[10px]">ACTIVE</span>
</div>
</div>
</div>
<!-- Node 4 (Mainline continuation) -->
<div class="absolute left-[650px] top-1/2 -translate-y-1/2 flex flex-col items-center opacity-50">
<div class="w-4 h-4 rounded-full bg-[#262626] border-2 border-[#0a0a0a] z-10"></div>
</div>
<!-- Node 5 (Future) -->
<div class="absolute left-[900px] top-1/2 -translate-y-1/2 flex flex-col items-center opacity-30">
<div class="w-4 h-4 rounded-full bg-[#262626] border-2 border-[#0a0a0a] z-10"></div>
<span class="absolute top-8 font-label-caps text-label-caps text-neutral-600 whitespace-nowrap">Resolution</span>
</div>
</div>
</div>
<!-- Legend / Controls (Minimal) -->
<div class="absolute bottom-8 right-12 flex gap-6 bg-[#161616] border border-[#262626] p-4 rounded-lg backdrop-blur-xl">
<div class="flex items-center gap-2">
<div class="w-3 h-3 rounded-full bg-primary-container glow-line"></div>
<span class="font-label-caps text-label-caps text-neutral-400">Canonical Path</span>
</div>
<div class="flex items-center gap-2">
<div class="w-3 h-3 rounded-full border-2 border-primary-container"></div>
<span class="font-label-caps text-label-caps text-neutral-400">Divergent Branch</span>
</div>
</div>
</main>
</body></html>
