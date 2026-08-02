o = new point
see "attributes:" + nl
see attributes(o)
see "methods:" + nl
see methods(o)

addattribute(o, "color")
o.color = "red"
see "color: " + o.color + nl

addmethod(o, "info", func { see "x=" + x + " y=" + y + nl })
o.info()

class point
	x = 5
	y = 7
	func area
		return x * y
