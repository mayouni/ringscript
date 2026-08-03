===========================================================================
  RingScript starter — write web pages in Ring
===========================================================================

WHAT THIS IS
------------
A tiny web page whose logic is written in Ring instead of JavaScript.
Everything needed to run it is already in this folder. Nothing to install.


HOW TO RUN IT  (this is the whole procedure)
--------------------------------------------
  Windows          double-click   start-windows.bat
  macOS / Linux    double-click   start-mac-linux.sh
                   (or in a terminal:  ./start-mac-linux.sh)

A small black window opens — that is the web server. Your browser opens at
http://localhost:8377 and the page is running.

To stop: close the black window.

Keep that window open while you work. It is not an error message.


WHAT YOU ARE LOOKING AT
-----------------------
Two files matter, and you can open both in any text editor:

  index.html    the page itself — the boxes, buttons and text
  app.ring      the Ring code that makes it work

Open app.ring. It is ordinary Ring — functions, if, variables, strings.
There is no new language to learn. Two calls connect it to the page:

  Page(:getvalue, [ :id = "name" ])              read what the user typed
  Page(:settext,  [ :id = "message", :text = ])  write text into the page

And in index.html, a button runs one of your Ring functions:

  <button onclick="ring.call('Greet')">Greet</button>


TRY CHANGING SOMETHING
----------------------
1. Open app.ring in a text editor.
2. Find the line with "Ahlan, " and change the greeting to your own words.
3. Save the file.
4. Go back to the browser and press Refresh (F5).

Your change is live. There is no build step, nothing to compile, no tools
to install. Edit, save, refresh.


THE OTHER FILES
---------------
  ringscript.js     loads the Ring engine into the page  (~20 KB)
  ringscript.wasm   the Ring language itself             (~360 KB)
  server/           a small web server, one file per system

Those two ringscript files ARE RingScript. To put Ring on a page of your
own, copy them next to your HTML and add two lines — see index.html.


WHY A SERVER, AND NOT JUST OPENING index.html?
-----------------------------------------------
If you double-click index.html directly, it will not work.

Browsers refuse to let a page read files from your hard disk — a security
rule that applies to every web page, not just this one. Files must arrive
over http://. That is all the server in the black window does: it hands
your own folder to the browser. It does not go on the internet, and
nothing leaves your machine.


WHAT RINGSCRIPT IS NOT
----------------------
RingScript runs Ring INSIDE A WEB PAGE. It is not a way to run Ring
programs you already have.

In particular, a desktop program will NOT run here — anything using
RingQt, GUILib, windows, forms or drawing. Those draw on a desktop
window through Qt, which does not exist in a browser. So a program like
applications/analogclock/AnalogClock.ring cannot be loaded and run.

The same IDEA works on the web, but the page is built differently: the
clock face is HTML, and Ring updates it. What carries over is your Ring —
the logic, the rules, the calculations. What changes is the screen it
draws on.

Also unavailable, for the same reason (a browser tab has neither):
  - reading and writing files on disk
  - system() and running other programs
  - databases opened directly from disk

A web page gets its data from a server instead. Your Ring logic does not
change; only where the data comes from.


WHERE TO GO NEXT
----------------
  Try it online, nothing to install   https://mayouni.github.io/ringscript/playground/
  Questions and answers               https://mayouni.github.io/ringscript/faq.html
  Full documentation                  https://github.com/mayouni/ringscript/blob/main/docs/README.md

RingScript 0.9 — MIT. Part of the Softanza Project, by Mansour Ayouni.
