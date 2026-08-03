# clock.ring — an analog clock, written in Ring.
#
# Ring works out where the three hands should point; the page draws them.
# This runs once a second, because clock.html asks it to.

func Tick aData

	# time() gives the current time as text, like "14:35:09"
	cNow = time()

	# Pull the three numbers out of it. substr(text, start, howmany)
	nHour   = number(substr(cNow, 1, 2))
	nMinute = number(substr(cNow, 4, 2))
	nSecond = number(substr(cNow, 7, 2))

	# A full turn is 360 degrees.
	#   60 seconds in a turn -> 6 degrees per second
	#   60 minutes in a turn -> 6 degrees per minute
	#   12 hours   in a turn -> 30 degrees per hour
	# The smaller hands nudge the bigger ones along, which is why a real
	# hour hand sits between two numbers at half past.

	nSecondAngle = nSecond * 6
	nMinuteAngle = nMinute * 6 + nSecond * 0.1
	nHourAngle   = (nHour % 12) * 30 + nMinute * 0.5

	# Turn each hand. "rotate" is not built in — clock.html teaches the
	# page that word in four lines of JavaScript, once.
	Page(:rotate, [ :id = "hour-hand",   :deg = nHourAngle   ])
	Page(:rotate, [ :id = "minute-hand", :deg = nMinuteAngle ])
	Page(:rotate, [ :id = "second-hand", :deg = nSecondAngle ])

	# And write the time underneath, in words a person reads.
	Page(:settext, [ :id = "digital", :text = cNow ])
	Page(:settext, [ :id = "today",   :text = date() ])
