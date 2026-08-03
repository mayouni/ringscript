# app.ring — the whole program.
#
# This is ordinary Ring. Only two things here are about the web:
#   Page(:getvalue, ...)  reads a box on the screen
#   Page(:settext,  ...)  writes text into the page
#
# Change anything below, save the file, then press Refresh in the browser.

nGreetings = 0

# Every function a button calls receives one value — whatever the click
# sent with it. This page sends nothing, so aData is empty and unused.
# Just declare it and ignore it.

func Greet aData

	cName = Page(:getvalue, [ :id = "name" ])

	if cName = ""
		cName = "stranger"
	ok

	nGreetings++

	Page(:settext, [ :id = "message",
		:text = "Ahlan, " + cName + "!" ])

	Page(:settext, [ :id = "count",
		:text = "Greetings so far: " + nGreetings ])

func AddThem aData

	# What the user types is text, so adding 0 makes it a number.
	nFirst  = 0 + Page(:getvalue, [ :id = "first"  ])
	nSecond = 0 + Page(:getvalue, [ :id = "second" ])

	Page(:settext, [ :id = "sum",
		:text = "" + nFirst + " + " + nSecond + " = " + (nFirst + nSecond) ])

func SayVersion aData

	Page(:settext, [ :id = "version",
		:text = "Running Ring " + version() + " in your browser" ])
