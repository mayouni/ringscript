aPackageInfo = [
	:name = "RingScript",
	:description = "The Ring language, resident in the browser: the real Ring VM compiled to WebAssembly, with a resident bridge and a Playground.",
	:folder = "ringscript",
	:developer = "Mansour Ayouni",
	:email = "kalidianow@gmail.com",
	:license = "MIT License",
	:version = "0.9",
	:ringversion = "1.27",
	:versions = 	[
		[
			:version = "0.9",
			:branch = "main"
		]
	],
	:libs = 	[
		[
			:name = "",
			:version = "",
			:providerusername = ""
		]
	],
	:files = 	[
		# Entry points
		"main.ring",
		"lib.ring",
		"package.ring",
		"README.md",
		"LICENSE",

		# The runtime you deploy: these two files ARE RingScript
		"playground/ringscript.js",
		"playground/ringscript.wasm",

		# The Playground (served by `ringpm run ringscript`)
		"playground/index.html",
		"playground/examples-data.js",
		"playground/site.css",
		"playground/favicon.ico",

		# Scaffolding template used by `ring main.ring new <folder>`
		"cli/starter.html",

		# Documentation
		"docs/README.md",
		"docs/getting-started.md",
		"docs/scripting-pages.md",
		"docs/api.md",
		"docs/architecture.md",
		"docs/compatibility.md"
	],
	:ringfolderfiles = 	[

	],
	# Prebuilt static servers, about 40 KB each — RingPM downloads only the
	# one matching the user's platform, so no toolchain is ever needed.
	:windowsfiles = 	[
		"bin/ringscript-serve-windows-x64.exe"
	],
	:linuxfiles = 	[
		"bin/ringscript-serve-linux-x64",
		"bin/ringscript-serve-linux-arm64"
	],
	:ubuntufiles = 	[
		"bin/ringscript-serve-linux-x64",
		"bin/ringscript-serve-linux-arm64"
	],
	:fedorafiles = 	[
		"bin/ringscript-serve-linux-x64",
		"bin/ringscript-serve-linux-arm64"
	],
	:macosfiles = 	[
		"bin/ringscript-serve-macos-x64",
		"bin/ringscript-serve-macos-arm64"
	],
	:windowsringfolderfiles = 	[

	],
	:linuxringfolderfiles = 	[

	],
	:ubunturingfolderfiles = 	[

	],
	:fedoraringfolderfiles = 	[

	],
	:macosringfolderfiles = 	[

	],
	:run = "ring main.ring",
	:windowsrun = "",
	:linuxrun = "",
	:macosrun = "",
	:ubunturun = "",
	:fedorarun = "",
	# Downloaded files arrive without the executable bit on Unix.
	:setup = "",
	:windowssetup = "",
	:linuxsetup = "chmod +x bin/ringscript-serve-linux-x64 bin/ringscript-serve-linux-arm64",
	:macossetup = "chmod +x bin/ringscript-serve-macos-x64 bin/ringscript-serve-macos-arm64",
	:ubuntusetup = "chmod +x bin/ringscript-serve-linux-x64 bin/ringscript-serve-linux-arm64",
	:fedorasetup = "chmod +x bin/ringscript-serve-linux-x64 bin/ringscript-serve-linux-arm64",
	:remove = "",
	:windowsremove = "",
	:linuxremove = "",
	:macosremove = "",
	:ubunturemove = "",
	:fedoraremove = ""
]
