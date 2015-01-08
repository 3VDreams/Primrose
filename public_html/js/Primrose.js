function Primrose(canvasID, options) {
    options = options || {};

    var languageGrammar = options.languageGrammar || Grammar.JavaScript;
    this.setLanguageGrammar = function (lang) {
        languageGrammar = lang;
    };

    var codePage = options.codePage || CodePages.EN_US;
    this.setCodePage = function (cp) {
        codePage = cp;
    };

    var history = [(options.file || "").split("\n")];
    this.getLines = function () {
        return history[history.length - 1].slice();
    };

    this.pushUndo = function (lines) {
        history.push(lines);
    };

    this.popUndo = function () {
        if (history.length > 1) {
            return history.pop();
        }
    };

    this.frontCursor = new Cursor();
    this.backCursor = new Cursor();
    this.bothCursors = new CombinedCursor(this.frontCursor, this.backCursor);

    var canvas = cascadeElement(canvasID, "canvas", HTMLCanvasElement);
    var gfx = canvas.getContext("2d");
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";

    var dragging = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.gridLeft = 0;
    var leftGutterWidth = 1;
    var rightGutterWidth = 1;
    var bottomGutterHeight = 1;
    var gridWidth = 0;
    var gridHeight = 0;
    this.pageSize = 0;
    this.tabWidth = options.tabWidth || 4;
    this.tabString = "";
    for (var i = 0; i < this.tabWidth; ++i) {
        this.tabString += " ";
    }

    this.DOMElement = cascadeElement("primrose-surrogate-textarea-container", "div", HTMLDivElement);
    this.DOMElement.style.position = "absolute";
    this.DOMElement.style.left = 0;
    this.DOMElement.style.top = 0;
    this.DOMElement.style.width = 0;
    this.DOMElement.style.height = 0;
    this.DOMElement.style.overflow = "hidden";

    var surrogate = cascadeElement("primrose-surrogate-textarea", "textarea", HTMLTextAreaElement);
    surrogate.style.position = "absolute";
    surrogate.style.left = canvas.offsetLeft + "px";
    surrogate.style.top = canvas.offsetTop + "px";
    surrogate.style.width = canvas.offsetWidth + "px";
    surrogate.style.height = canvas.offsetHeigth + "px";
    surrogate.value = this.getLines().join("\n");
    this.DOMElement.appendChild(surrogate);

    var keyEventSource = options.keyEventSource || surrogate;
    var clipboardEventSource = options.clipboardEventSource || surrogate;
    var mouseEventSource = options.mouseEventSource || canvas;

    this.editText = function (evt) {
        evt = evt || event;
        var key = evt.keyCode;
        // don't do anything about the actual press of SHIFT, CTRL, or ALT
        if (key !== Keys.SHIFT && key !== Keys.CTRL && key !== Keys.ALT) {
            var typeA = (evt.ctrlKey && "CTRL" || "")
                    + (evt.altKey && "ALT" || "");
            var typeB = (typeA + (evt.shiftKey && "SHIFT" || "")) || "NORMAL";
            typeA = typeA || "NORMAL";
            var codeCommandA = typeA + key;
            var codeCommandB = typeB + key;
            var charCommand = typeB + "_" + codePage.SHIFT[key];
            var func = Commands[codeCommandB] || Commands[codeCommandA] || Commands[charCommand];
            if (func) {
                var currentCursor = evt.shiftKey ? this.backCursor : this.bothCursors;
                if (func instanceof Function) {
                    func.call(this, this.getLines(), currentCursor);
                }
                else {
                    currentCursor[func](this.getLines(), currentCursor);
                }
                currentCursor = evt.shiftKey ? this.backCursor : this.frontCursor;
                this.scrollIntoView(currentCursor);
                evt.preventDefault();
            }
            else if (codePage[typeB]) {
                var char = codePage[typeB][key];
                if (char) {
                    this.insertAtCursor(char);
                    this.scrollIntoView(this.frontCursor);
                    if (key === Keys.SPACEBAR) {
                        evt.preventDefault();
                    }
                }
            }
            else {
                // what just happened?
                console.log(typeB, key);
            }
        }
        this.drawText();
    };

    function minDelta(v, minV, maxV) {
        var dvMinV = v - minV;
        var dvMaxV = v - maxV + 1;
        var dv = 0;
        if (!(dvMinV >= 0 && dvMaxV < 0)) {
            // compare the absolute values, so we get the smallest change regardless
            // of direction
            if (Math.abs(dvMinV) < Math.abs(dvMaxV)) {
                dv = dvMinV;
            }
            else {
                dv = dvMaxV;
            }
        }

        return dv;
    }

    this.scrollIntoView = function (currentCursor) {
        this.scrollTop += minDelta(currentCursor.y, this.scrollTop, this.scrollTop + gridHeight);
        this.scrollLeft += minDelta(currentCursor.x, this.scrollLeft, this.scrollLeft + gridWidth);
    };

    function readClipboard(evt) {
        var i = evt.clipboardData.types.indexOf("text/plain");
        if (i < 0) {
            for (i = 0; i < evt.clipboardData.types.length; ++i) {
                if (/^text/.test(evt.clipboardData.types[i])) {
                    break;
                }
            }
        }
        if (i >= 0) {
            var type = evt.clipboardData.types[i];
            var str = evt.clipboardData.getData(type);
            evt.preventDefault();
            this.pasteAtCursor(str);
        }
    }

    this.drawText = function () {
        var clearFunc = theme.regular.backColor ? "fillRect" : "clearRect";
        if (theme.regular.backColor) {
            gfx.fillStyle = theme.regular.backColor;
        }
        gfx[clearFunc](0, 0, gfx.canvas.width, gfx.canvas.height);

        var lines = this.getLines();
        var lineCountWidth = Math.ceil(Math.log(lines.length) / Math.LN10);
        this.gridLeft = lineCountWidth + leftGutterWidth;
        gridWidth = Math.floor(canvas.width / this.characterWidth) - this.gridLeft - rightGutterWidth;
        var scrollRight = this.scrollLeft + gridWidth;
        gridHeight = Math.floor(canvas.height / this.characterHeight) - bottomGutterHeight;
        this.pageSize = Math.floor(gridHeight);
        var text = lines.join("\n");
        var tokens = languageGrammar.tokenize(text);

        // group the tokens into rows
        var rows = [[]];
        for (var i = 0; i < tokens.length; ++i) {
            var t = tokens[i];
            if (t.type === "newlines") {
                rows.push([]);
            }
            else {
                rows[rows.length - 1].push(t);
            }
        }

        var minCursor = Cursor.min(this.frontCursor, this.backCursor);
        var maxCursor = Cursor.max(this.frontCursor, this.backCursor);
        var tokenFront = new Cursor();
        var tokenBack = new Cursor();
        var maxLineWidth = 0;

        for (var y = 0; y < rows.length; ++y) {
            // skip drawing rows that aren't in view
            if (this.scrollTop <= y && y < this.scrollTop + gridHeight) {

                // draw the left gutter
                var lineNumber = y.toString();
                while (lineNumber.length < lineCountWidth) {
                    lineNumber = " " + lineNumber;
                }
                gfx.fillStyle = theme.regular.selectedBackColor
                        || Themes.DEFAULT.regular.selectedBackColor;
                gfx.fillRect(
                        0,
                        (y - this.scrollTop + 0.2) * this.characterHeight,
                        (lineNumber.length + leftGutterWidth) * this.characterWidth,
                        this.characterHeight);
                gfx.font = "bold " + this.characterHeight + "px " + theme.fontFamily;
                gfx.fillStyle = theme.regular.foreColor;
                gfx.fillText(
                        lineNumber,
                        0,
                        (y - this.scrollTop + 1) * this.characterHeight);

                // draw the tokens on this row
                var row = rows[y];
                for (var n = 0; n < row.length; ++n) {
                    var t = row[n];
                    var toPrint = t.value;
                    tokenBack.x += toPrint.length;
                    tokenBack.i += toPrint.length;

                    // skip drawing tokens that aren't in view
                    if (this.scrollLeft <= tokenBack.x && tokenFront.x < scrollRight) {
                        if (tokenFront.x < this.scrollLeft) {
                            var dx = this.scrollLeft - tokenFront.x;
                            tokenFront.x += dx;
                            tokenFront.i += dx;
                            toPrint = toPrint.substring(dx);
                        }

                        // draw the selection box
                        if (minCursor.i <= tokenBack.i && tokenFront.i < maxCursor.i) {
                            var selectionFront = Cursor.max(minCursor, tokenFront);
                            var selectionBack = Cursor.min(maxCursor, tokenBack);
                            var cw = selectionBack.i - selectionFront.i;
                            gfx.fillStyle = theme.regular.selectedBackColor
                                    || Themes.DEFAULT.regular.selectedBackColor;
                            gfx.fillRect(
                                    (selectionFront.x - this.scrollLeft + this.gridLeft) * this.characterWidth,
                                    (selectionFront.y - this.scrollTop + 0.2) * this.characterHeight,
                                    cw * this.characterWidth,
                                    this.characterHeight);
                        }

                        // draw the text
                        var style = theme[t.type] || {};
                        var font = (style.fontWeight || theme.regular.fontWeight || "")
                                + " " + (style.fontStyle || theme.regular.fontStyle || "")
                                + " " + this.characterHeight + "px " + theme.fontFamily;
                        gfx.font = font.trim();
                        gfx.fillStyle = style.foreColor || theme.regular.foreColor;
                        gfx.fillText(
                                toPrint,
                                (tokenFront.x - this.scrollLeft + this.gridLeft) * this.characterWidth,
                                (tokenFront.y - this.scrollTop + 1) * this.characterHeight);
                    }

                    tokenFront.copy(tokenBack);
                }
            }
            maxLineWidth = Math.max(maxLineWidth, tokenBack.x);
            tokenFront.x = 0;
            ++tokenFront.y;
            ++tokenFront.i;
            tokenBack.copy(tokenFront);
        }

        // draw the cursor caret
        gfx.beginPath();
        gfx.strokeStyle = "black";
        gfx.moveTo(
                (this.frontCursor.x - this.scrollLeft + this.gridLeft) * this.characterWidth,
                (this.frontCursor.y - this.scrollTop) * this.characterHeight);
        gfx.lineTo(
                (this.frontCursor.x - this.scrollLeft + this.gridLeft) * this.characterWidth,
                (this.frontCursor.y - this.scrollTop + 1.25) * this.characterHeight);
        gfx.moveTo(
                (this.backCursor.x - this.scrollLeft + this.gridLeft) * this.characterWidth + 1,
                (this.backCursor.y - this.scrollTop) * this.characterHeight);
        gfx.lineTo(
                (this.backCursor.x - this.scrollLeft + this.gridLeft) * this.characterWidth + 1,
                (this.backCursor.y - this.scrollTop + 1.25) * this.characterHeight);
        gfx.stroke();

        // draw the scrollbars

        //vertical
        var scrollY = (this.scrollTop * canvas.height) / lines.length + this.characterHeight;
        var scrollBarHeight = gridHeight * canvas.height / lines.length - bottomGutterHeight * this.characterHeight;
        gfx.fillStyle = theme.regular.selectedBackColor
                || Themes.DEFAULT.regular.selectedBackColor;
        gfx.fillRect(
                canvas.width - this.characterWidth,
                scrollY,
                this.characterWidth,
                scrollBarHeight);

        // horizontal
        var scrollX = (this.scrollLeft * canvas.width) / maxLineWidth + this.characterWidth;
        var scrollBarWidth = gridWidth * canvas.width / maxLineWidth - (this.gridLeft + rightGutterWidth) * this.characterWidth;
        gfx.fillStyle = theme.regular.selectedBackColor
                || Themes.DEFAULT.regular.selectedBackColor;
        gfx.fillRect(
                scrollX,
                gridHeight * this.characterHeight,
                scrollBarWidth,
                this.characterHeight);
    };

    function measureText() {
        var r = this.getPixelRatio();
        this.characterHeight = fontSize * r;
        canvas.width = canvas.clientWidth * r;
        canvas.height = canvas.clientHeight * r;
        gfx.font = this.characterHeight + "px " + theme.fontFamily;
        this.characterWidth = gfx.measureText("M").width;
        this.drawText();
    }

    var fontSize = options.fontSize || 14;
    this.setFontSize = function (sz) {
        fontSize = sz;
        measureText.call(this);
    };

    this.increaseFontSize = function () {
        ++fontSize;
        measureText.call(this);
    };

    this.decreaseFontSize = function () {
        if (fontSize > 1) {
            --fontSize;
            measureText.call(this);
        }
    };

    var theme = null;
    this.setTheme = function (t) {
        theme = t;
        measureText.call(this);
    };
    this.setTheme(options.theme || Themes.DEFAULT);

    keyEventSource.addEventListener("keydown", this.editText.bind(this));
    keyEventSource.addEventListener("keyup", function () {
        surrogate.value = this.getLines().join("\n");
        surrogate.selectionStart = this.frontCursor.i;
        surrogate.selectionLength = this.backCursor.i - this.frontCursor.i;
    });

    clipboardEventSource.addEventListener("copy", this.copySelectedText.bind(this));
    clipboardEventSource.addEventListener("cut", this.cutSelectedText.bind(this));
    clipboardEventSource.addEventListener("paste", readClipboard.bind(this));

    function setCursorXY(cursor, evt) {
        var lines = this.getLines();
        var cell = this.pixel2cell(evt.layerX, evt.layerY);
        cursor.setXY(cell.x, cell.y, lines);
        this.drawText();
    }

    mouseEventSource.addEventListener("mousedown", function (evt) {
        setCursorXY.call(this, this.bothCursors, evt);
        dragging = true;
    }.bind(this));

    mouseEventSource.addEventListener("mouseup", function () {
        dragging = false;
        surrogate.focus();
    });

    mouseEventSource.addEventListener("mousemove", function (evt) {
        if (dragging) {
            setCursorXY.call(this, this.backCursor, evt);
        }
    }.bind(this));
}

Primrose.prototype.pixel2cell = function (x, y) {
    var r = this.getPixelRatio();
    x = Math.floor(x * r / this.characterWidth) + this.scrollLeft - this.gridLeft;
    y = Math.floor((y * r / this.characterHeight) - 0.25) + this.scrollTop;
    return {x: x, y: y};
};

Primrose.prototype.cell2i = function (x, y) {
    var lines = this.getLines();
    var i = 0;
    for (var dy = 0; dy < y; ++dy) {
        i += lines[dy].length + 1;
    }
    i += x;
    return i;
};

Primrose.prototype.i2cell = function (i) {
    var lines = this.getLines();
    for (var y = 0; y < lines.length; ++y) {
        if (i <= lines.length) {
            return {x: i, y: y};
        }
        else {
            i -= lines.length - 1;
        }
    }
};

Primrose.prototype.getPixelRatio = function () {
    return window.devicePixelRatio || 1;
};

Primrose.prototype.insertAtCursor = function (str) {
    if (str.length > 0) {
        this.deleteSelection();
        var lines = this.getLines();
        var parts = str.split("\n");
        parts[0] = lines[this.frontCursor.y].substring(0, this.frontCursor.x) + parts[0];
        parts[parts.length - 1] += lines[this.frontCursor.y].substring(this.frontCursor.x);
        lines.splice.bind(lines, this.frontCursor.y, 1).apply(lines, parts);
        for (var i = 0; i < str.length; ++i) {
            this.frontCursor.right(lines);
        }
        this.backCursor.copy(this.frontCursor);
        this.pushUndo(lines);
    }
};

Primrose.prototype.export = function () {
    return this.getLines().map(function (m) {
        return "\"" + m.replace(/"/g, "\\\"") + "\\n\"";
    }).join("\n+ ");
};

Primrose.prototype.copySelectedText = function (evt) {
    if (this.frontCursor.i !== this.backCursor.i) {
        var minCursor = Cursor.min(this.frontCursor, this.backCursor);
        var maxCursor = Cursor.max(this.frontCursor, this.backCursor);
        var lines = this.getLines();
        var text = lines.join("\n");
        var str = text.substring(minCursor.i, maxCursor.i);
        evt.clipboardData.setData("text/plain", str);
    }
    evt.preventDefault();
};

Primrose.prototype.cutSelectedText = function (evt) {
    this.copySelectedText(evt);
    this.deleteSelection();
    this.drawText();
};

Primrose.prototype.pasteAtCursor = function (str) {
    this.deleteSelection();
    var lines = this.getLines();
    var text = lines.join("\n");
    var minCursor = Cursor.min(this.frontCursor, this.backCursor);
    var left = text.substring(0, minCursor.i);
    var right = text.substring(minCursor.i);
    text = left + str + right;
    lines = text.split("\n");
    this.pushUndo(lines);
    for (var i = 0; i < str.length; ++i) {
        this.frontCursor.right(lines);
    }
    this.backCursor.copy(this.frontCursor);
    this.drawText();
};

Primrose.prototype.deleteSelection = function () {
    if (this.frontCursor.i !== this.backCursor.i) {
        var minCursor = Cursor.min(this.frontCursor, this.backCursor);
        var maxCursor = Cursor.max(this.frontCursor, this.backCursor);
        var lines = this.getLines();
        // TODO: don't rejoin the string first.
        var text = lines.join("\n");
        var left = text.substring(0, minCursor.i);
        var right = text.substring(maxCursor.i);
        text = left + right;
        lines = text.split("\n");
        this.pushUndo(lines);
        maxCursor.copy(minCursor);
    }
};