/*
** RingScript challenge examples — from ring-examples-for-wasm.txt.
** Each entry: { id, title, code, input } — `input` feeds Ring's `give`,
** one line per prompt. Shared by web/examples.html and tests/examples-oracle.js.
*/
(function (global) {
    "use strict";

    const RING_EXAMPLES = [
        {
            id: "hello-world",
            title: "Hello World",
            input: "",
            code: '? "Hello, World!"\n\nSee "Hello, World!" + nl\n\nput "Hello, World!" + nl\n\nprint("Hello, World!")\n',
        },
        {
            id: "print-numbers",
            title: "Print Numbers",
            input: "",
            code: "for t=1 to 10 \n    ? t\n    if t=3 \n        ? :three\n    ok\nnext\n",
        },
        {
            id: "say-hello",
            title: "Say Hello",
            input: "Mansour\n",
            code: '? "Enter your name: "  give name  ? "Hello " + name\n\nfor c in name\n    ? c\nnext\n',
        },
        {
            id: "sum-two-numbers",
            title: "Sum two Numbers",
            input: "15\n4\n",
            code: '? "Enter Number(1): " give nNum1\n? "Enter Number(2): " give nNum2\n? "Sum: " + (0+nNum1+nNum2)\n',
        },
        {
            id: "using-functions",
            title: "Using Functions",
            input: "",
            code: "one() two() three()\n? sum(10,10)\n\nmessage() anotherMessage()\n\nfunc one   ? :one \nfunc two   ? :two \nfunc three ? :three\n\n# We can use braces\nfunc sum(x,y) {\n    return x+y\n}\n\n# We can use end|endfunction\ndef message \n    ? \"I Love Programming!\"\nend\n\nfunction anotherMessage() \n    ? \"What about you?\"\nendfunction \n",
        },
        {
            id: "using-objects",
            title: "Using Objects",
            input: "",
            code: "new point { x=10 y=20 z=30 ? self }\n\nclass point x y z\n",
        },
        {
            id: "variable-scope",
            title: "Variable Scope",
            input: "",
            code: 'nCount = 10    # Global variable\n\nfunc main\n    nID = 1    # Local variable\n    see "Count = " + nCount + nl + "ID = " + nID\n',
        },
        {
            id: "using-lists",
            title: "Using Lists",
            input: "",
            code: 'aList = ["one","two","three"]\naList2 = aList  # Deep Copy\n\naList[1] = 1    # Index starts from 1  \n  \n? alist[1]      # print 1\n? aList2[1]     # print one\n\n# We can use lists during definition \nmyList = [ [:a,:b,:c] , myList[1] , myList[1] ]\nsee myList      # print a b c a b c a b c\n',
        },
        {
            id: "lists-as-hashtables",
            title: "Using Lists as HashTables",
            input: "",
            code: 'person = [\n    :name  = "Alice",\n    :age   = 30,\n    :email = "alice@example.com",\n    :address = [\n        :city    = "Cairo",\n        :country = "Egypt",\n        :zip     = "12345"\n    ],\n    :hobbies = ["chess", "coding", "reading"]\n]\n? "Name  : " + person[:name]\n? "Age   : " + person[:age]\n? "Email : " + person[:email]\n? "City    : " + person[:address][:city]\n? "Country : " + person[:address][:country]\n? "Zip     : " + person[:address][:zip]\n? "Hobbies:"\nfor hobby in person[:hobbies]\n    ? "  - " + hobby\nnext\n',
        },
        {
            id: "exit-two-loops",
            title: "Exit from Two Loops",
            input: "",
            code: 'for x = 1 to 10 {\n    for y = 1 to 10 {\n        see "x=" + x + " y=" + y + nl\n        if x = 3 and y = 5 {\n            exit 2     # exit from 2 loops\n        }\n    }\n}\n\n? "NICE TO MEET YOU!"\n',
        },
        {
            id: "using-evals",
            title: "Using Evals",
            input: "",
            code: '? "Creating a new class dynamically..."\neval("class Point x y z")\n\n? "Printing the instance..."\n? new Point {x=10 y=20 z=30}\n',
        },
        {
            id: "change-keywords-arabic",
            title: "Change Keywords (Arabic Syntax)",
            input: "25\nمنصور\n",
            code: "ChangeRingKeyword see اطبع\nChangeRingKeyword give ادخل\nChangeRingKeyword if لو\nChangeRingKeyword but امالو\nChangeRingKeyword else عداذلك\nChangeRingKeyword ok تمام\n\nسطرجديد = nl\n\nاطبع \"السلام عليكم ورحمة الله وبركاته\" + سطرجديد\n\nاطبع \"كم عمرك\" + سطرجديد\nادخل العمر\n\nالعمر = 0 + العمر\nلو العمر < 10\n        اطبع \"اسمك ايه ياجميل؟\" + سطرجديد\nامالو العمر < 30\n        اطبع \"اسمك ايه ياابو الشباب؟\" + سطرجديد \nامالو العمر < 60\n        اطبع \"اسم حضرتك ايه؟\" +سطرجديد\nعداذلك\n        اطبع \"والله حضرتك منورنا ... اتشرف ب اسم حضرتك؟\" + سطرجديد\nتمام\n\nادخل الاسم\nاطبع \" اهلا وسهلا يا: \" + الاسم\n",
        },
        {
            id: "call-methods-braces",
            title: "Call Methods Using Braces",
            input: "",
            code: 'new point {            \n    x=10  y=20  z=30       \n    print()                # Call the print() method\n}\n                      \nclass point            \n\n    x y z\n\n    ? "Hello, World!"                  \n\n    func print             \n        ? self \n\n    func braceStart\n        ? "Welcome"\n\n    func braceEnd\n        ? "Goodbye!"\n',
        },
        {
            id: "brace-expr-eval",
            title: "Using BraceExprEval",
            input: "",
            code: 'new Sum {\n    10\n    20  40\n    100 2000 \n    -20\n    201.5\n}\n\nclass Sum\n\n    nSum = 0\n\n    func braceExprEval nValue\n        if ! isNumber(nValue) return ok\n        nSum += nValue\n\n    func braceEnd\n        ? "Sum: " + nSum\n',
        },
        {
            id: "natural-commands",
            title: "Natural Commands",
            input: "",
            code: 'TimeForFun = new journey\n\n# The first surprise!\nTimeForFun {\n    Hello it is me     # What a beautiful programming world!\n}\n\n# Our Class\nclass journey\n\n    hello it is me\n\n    func GetHello\n        ? "Hello"\n\n    func braceEnd\n        ? "Goodbye!"\n',
        },
        {
            id: "main-menu",
            title: "Main Menu",
            input: "3\n5\n",
            code: 'while True\n\n        see "\n\n        Main Menu\n        ===========\n        [1] Say Hello\n        [2] Sum two numbers\n        [3] Stars\n        [4] Fact\n        [5] Exit\n\n        " give nMenu ? nl\n\n        Switch nMenu\n        On 1 sayhello()\n        On 2 Sum()\n        On 3 Stars()\n        On 4\n             ? "Enter Number : " give x\n             ? "Output : "\n\n             Try\n                 ? Fact(number(x))\n             Catch\n                 ? "Error in parameters!" \n             Done\n\n        On "5" return\n        Other ? "bad option" \n        Off\n\nend\n\nfunc sayhello\n            ? "Enter your name ? " give fname\n            ? "Hello " + fname + nl\n\nfunc sum\n            ? "number 1 : " give num1 ? "number 2 : " give num2\n            ? "Sum : " + ( 0 + num1 + num2 )\n\nfunc stars\n            for x = 1 to 10\n                see space(8)\n                for y = 1 to x see "*" next see nl\n            next\n\nfunc fact x if x = 0 return 1 else return x * fact(x-1) ok\n\nfunc space x y = "" for t=1 to x y += " " next return y\n',
        },
    ];

    // ---- second wave: from the Ring documentation (doc1.27) and samples,
    // ---- byte-verified against native ring.exe by tests/samples-sweep.js
    RING_EXAMPLES.push(
        {
            id: "functional-map",
            title: "Functional: Anonymous Functions & Map",
            input: "",
            code: 'Func Main\n\taList = [1,2,3,4]\n\tMap (aList , func x { \n\t\t\t\treturn x*x \n\t\t\t    } )\n\tsee aList\n\taList = [11,12,13,14]\n\tMap (aList , func x {\n\t\tif x%2=0\n\t\t\treturn "even"\n\t\telse\n\t\t\treturn "odd"\n\t\tok\n\t})\n\tsee aList\n\nFunc Map aList,cFunc\n\tfor x in aList\n\t\tx = call cFunc(x)\n\tnext\n',
        },
        {
            id: "first-class-functions",
            title: "First-class Functions",
            input: "",
            code: 'Func Main\n\tsee "before test2()" + nl\n\tf = Test2(:Test)\n\tsee "after test2()" + nl\n\tcall f()\n\nFunc Test\n\tsee "Message from test!" + nl\n\nFunc Test2 f1\n\tcall f1()\n\tSee "Message from test2!" + nl\n\treturn f1\n',
        },
        {
            id: "equality-of-functions",
            title: "Equality of Functions",
            input: "",
            code: 'f1 = func { see "hello" + nl }\n\nf2 = func { see "how are you?" + nl }\n\nf3 = f1\n\ncall f1()\ncall f2()\ncall f3()\n\nsee (f1 = f2) + nl\nsee (f2 = f3) + nl\nsee (f1 = f3) + nl\n',
        },
        {
            id: "operator-overloading",
            title: "Operator Overloading",
            input: "",
            code: 'o1 = new point { x = 10 y = 10 print("P1    : ") }\no2 = new point { x = 20 y = 40 print("P2    : ") }\n\no3 = o1 + o2\no3.print("P1+P2 : ")\n\nclass point x y\n\n\tfunc operator cOperator,Para\n\t\tresult = new point\n\t\tswitch cOperator\n\t\ton "+"\n\t\t\tresult.x = x + Para.x\n\t\t\tresult.y = y + Para.y\n\t\ton "-"\n\t\t\tresult.x = x - Para.x\n\t\t\tresult.y = y - Para.y\n\t\toff\n\t\treturn result\n\n\tfunc print cPoint\n\t\tsee cPoint + "(" + x + ", " + y + ")" + nl\n',
        },
        {
            id: "inheritance-super",
            title: "Inheritance & Super",
            input: "",
            code: 'o = new child\no.hello()\n\nclass parent\n\tfunc hello\n\t\tsee "parent says hello" + nl\n\nclass child from parent\n\tfunc hello\n\t\tsuper.hello()\n\t\tsee "child says hello" + nl\n',
        },
        {
            id: "private-attributes",
            title: "Private Attributes & Methods",
            input: "",
            code: 'o1 = new person {\n\tname = "Test"\n\tage = 20\n\tprint()\n\to1.printsalary()\n}\n\ntry\n\tsee o1.salary\ncatch\n\tsee cCatchError + nl\ndone\n\ntry\n\to1.increasesalary(1000)\ncatch\n\tsee cCatchError + nl\ndone\n\nClass Person\n\n\tname age\n\n\tfunc print\n\t\tsee "Name   : " + name + nl +\n\t\t    "Age    : " + age + nl\n\n\tfunc printsalary\n\t\tsee "Salary : " + salary + nl\n\n\tprivate\n\n\tsalary = 15000\n\n\tfunc increasesalary x\n\t\tsalary += x\n',
        },
        {
            id: "packages",
            title: "Packages",
            input: "",
            code: 'import mypkg\no = new helper\no.hi()\n\npackage mypkg\n\tclass helper\n\t\tfunc hi\n\t\t\tsee "hello from a packaged class" + nl\n',
        },
        {
            id: "reflection",
            title: "Reflection & Meta-programming",
            input: "",
            code: 'o = new point\nsee "attributes:" + nl\nsee attributes(o)\nsee "methods:" + nl\nsee methods(o)\n\naddattribute(o, "color")\no.color = "red"\nsee "color: " + o.color + nl\n\naddmethod(o, "info", func { see "x=" + x + " y=" + y + nl })\no.info()\n\nclass point\n\tx = 5\n\ty = 7\n\tfunc area\n\t\treturn x * y\n',
        }
    );

    if (typeof module !== "undefined" && module.exports) {
        module.exports = RING_EXAMPLES;
    }
    global.RING_EXAMPLES = RING_EXAMPLES;
})(typeof globalThis !== "undefined" ? globalThis : this);
