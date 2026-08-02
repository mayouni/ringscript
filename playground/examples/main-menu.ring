while True

        see "

        Main Menu
        ===========
        [1] Say Hello
        [2] Sum two numbers
        [3] Stars
        [4] Fact
        [5] Exit

        " give nMenu ? nl

        Switch nMenu
        On 1 sayhello()
        On 2 Sum()
        On 3 Stars()
        On 4
             ? "Enter Number : " give x
             ? "Output : "

             Try
                 ? Fact(number(x))
             Catch
                 ? "Error in parameters!" 
             Done

        On "5" return
        Other ? "bad option" 
        Off

end

func sayhello
            ? "Enter your name ? " give fname
            ? "Hello " + fname + nl

func sum
            ? "number 1 : " give num1 ? "number 2 : " give num2
            ? "Sum : " + ( 0 + num1 + num2 )

func stars
            for x = 1 to 10
                see space(8)
                for y = 1 to x see "*" next see nl
            next

func fact x if x = 0 return 1 else return x * fact(x-1) ok

func space x y = "" for t=1 to x y += " " next return y
