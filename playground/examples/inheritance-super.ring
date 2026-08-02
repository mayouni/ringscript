o = new child
o.hello()

class parent
	func hello
		see "parent says hello" + nl

class child from parent
	func hello
		super.hello()
		see "child says hello" + nl
