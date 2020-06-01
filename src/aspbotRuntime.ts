/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { DebugProtocol } from 'vscode-debugprotocol';


export interface MockBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class AspBotRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];
	private _sourceText: string;

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, MockBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;

	private _breakAddresses = new Set<string>();
	public ws;

	constructor() {
		super();
	}

	public WebSocketPort = 8899;
	public connectWs() {
		var _self = this;


		var WebSocket = require("websocket").w3cwebsocket;
		_self.ws = new WebSocket("ws://127.0.0.1:" + this.WebSocketPort);
		_self.ws.onmessage = function (evt) {
			console.log(evt.data);
			if (evt.data.indexOf("\"step\":") >= 0) {
				var step = JSON.parse(evt.data);

				_self._currentLine = parseInt(step.ln) - 1;
				_self.sendEvent('stopOnBreakpoint');
			}

			if (evt.data.indexOf("\"output\":") >= 0) {
				var _output = JSON.parse(evt.data);
				_self.sendEvent('output', _output.output, _self.sourceFile, _output.line + 1);
			}

			if (evt.data.indexOf("\"vars\":") >= 0) {
				var _output = JSON.parse(evt.data);
				_self.variables = [];
				if (_output.vars) {
					_output.vars.forEach(element => {
						var ttype = "string";
						if (element.DataType == "number") ttype = "float";
						if (element.DataType != "json") {
							_self.variables.push({
								name: element.Name,
								type: ttype,
								value: String(element.Value),
								variablesReference: 0
							});
						} else {
							try {
								_self.variables.push({
									name: element.Name,
									type: "object",
									value: JSON.stringify(JSON.parse(String(element.Value))),
									variablesReference: 0
								});
							} catch (error) {

							}
						}

					});
				}
			}

			if (evt.data.indexOf("\"end\":") >= 0) {
				_self.sendEvent('end');
			}
		};
		_self.ws.onerror = function (evt) {
			console.log(evt);
		}
		_self.ws.onclose = function (evt) {
			console.log(evt);
			setTimeout(function () {
				if (_self.ws.readyState === _self.ws.CLOSED) _self.connectWs();
			}, 1000);
		}
	}

	private variables: DebugProtocol.Variable[] = [];
	public getVariables() {
		return this.variables;
	}

	public RunScript(script: string) {
		var wscmdStart = { cmd: 'runscript', script: script, refresh: false };
		this.ws.send(JSON.stringify(wscmdStart));
	}

	/**
	 * Start executing the given program.
	 */
	public start(program: string, stopOnEntry: boolean, websocketPort: number = 8899, onretry = false,abrunnerPath="C:\\abdebugger\\abdebugger.exe") {
		var _self = this;
		_self.WebSocketPort = websocketPort;

		if (!onretry) {
			var exec = require('child_process').exec;
			exec(abrunnerPath+ ' ' + websocketPort, function callback(error, stdout, stderr) {
				// result
			});

			this.connectWs();
		}

		if (_self.ws.readyState != _self.ws.OPEN) {
			setTimeout(function () {
				_self.start(program, stopOnEntry, websocketPort,!onretry,abrunnerPath);
			}, onretry ? 3000 : 1000);
			return;
		}
		this.loadSource(program);
		this._currentLine = -1;
		//this.continue();

		var wscmdStart = { cmd: 'runscript', script: _self._sourceText, refresh: true };
		_self.ws.send(JSON.stringify(wscmdStart));
		this.continue();



		// this.verifyBreakpoints(this._sourceFile);

		// if (stopOnEntry) {
		// 	// we step once
		// 	this.step(false, 'stopOnEntry');
		// } else {
		// 	// we just start to run until we hit a breakpoint or an exception
		// 	this.continue();
		// }
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue(reverse = false) {
		var _self = this;
		var _cmd = { cmd: 'continue' };
		_self.ws.send(JSON.stringify(_cmd));
		//this.run(reverse, undefined);
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(reverse = false, event = 'stopOnStep') {
		var _self = this;
		var _cmd = { cmd: 'step' };
		_self.ws.send(JSON.stringify(_cmd));
		//this.run(reverse, event);
	}

	public terminate() {
		var _self = this;
		var _cmd = { cmd: 'terminate' };
		_self.ws.send(JSON.stringify(_cmd));
	}

	public pause() {
		var _self = this;
		var _cmd = { cmd: 'pause' };
		_self.ws.send(JSON.stringify(_cmd));
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			});
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	public getBreakpoints(path: string, line: number): number[] {

		const l = this._sourceLines[line];

		let sawSpace = true;
		const bps: number[] = [];
		for (let i = 0; i < l.length; i++) {
			if (l[i] !== ' ') {
				if (sawSpace) {
					bps.push(i);
					sawSpace = false;
				}
			} else {
				sawSpace = true;
			}
		}

		return bps;
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number): MockBreakpoint {
		var _self = this;
		const bp = <MockBreakpoint>{ verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<MockBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		var wscmd = { cmd: 'setBreakPoint', data: bp };
		if (_self.ws!=undefined && (_self.ws.readyState == _self.ws.OPEN)){
			_self.ws.send(JSON.stringify(wscmd));
		} else {
			setTimeout(function (){
				_self.setBreakPoint(path,line);
			},200);
			return bp;
		}
		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number): MockBreakpoint | undefined {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	/*
	 * Set data breakpoint.
	 */
	public setDataBreakpoint(address: string): boolean {
		if (address) {
			this._breakAddresses.add(address);
			return true;
		}
		return false;
	}

	/*
	 * Clear all data breakpoints.
	 */
	public clearAllDataBreakpoints(): void {
		this._breakAddresses.clear();
	}

	// private methods

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			this._sourceText = readFileSync(this._sourceFile).toString();
			this._sourceLines = this._sourceText.split('\n');
		}
	}

	/**
	 * Run through the file.
	 * If stepEvent is specified only run a single step and emit the stepEvent.
	 */
	// private run(reverse = false, stepEvent?: string) {
	// 	console.log("RUN");
	// }

	private verifyBreakpoints(path: string): void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();

					// if a line is empty or starts with '+' we don't allow to set a breakpoint but move the breakpoint down
					if (srcLine.length === 0 || srcLine.indexOf('+') === 0) {
						bp.line++;
					}
					// if a line starts with '-' we don't allow to set a breakpoint but move the breakpoint up
					if (srcLine.indexOf('-') === 0) {
						bp.line--;
					}
					// don't set 'verified' to true if the line contains the word 'lazy'
					// in this case the breakpoint will be verified 'lazy' after hitting it once.
					if (srcLine.indexOf('lazy') < 0) {
						bp.verified = true;
						this.sendEvent('breakpointValidated', bp);
					}
				}
			});
		}
	}

	/**
	 * Fire events if line has a breakpoint or the word 'exception' is found.
	 * Returns true is execution needs to stop.
	 */
	// private fireEventsForLine(ln: number, stepEvent?: string): boolean {

	// 	const line = this._sourceLines[ln].trim();

	// 	// if 'log(...)' found in source -> send argument to debug console
	// 	const matches = /log\((.*)\)/.exec(line);
	// 	if (matches && matches.length === 2) {
	// 		this.sendEvent('output', matches[1], this._sourceFile, ln, matches.index)
	// 	}

	// 	// if a word in a line matches a data breakpoint, fire a 'dataBreakpoint' event
	// 	const words = line.split(" ");
	// 	for (let word of words) {
	// 		if (this._breakAddresses.has(word)) {
	// 			this.sendEvent('stopOnDataBreakpoint');
	// 			return true;
	// 		}
	// 	}

	// 	// if word 'exception' found in source -> throw exception
	// 	if (line.indexOf('exception') >= 0) {
	// 		//this.sendEvent('stopOnException');
	// 		return true;
	// 	}

	// 	// is there a breakpoint?
	// 	const breakpoints = this._breakPoints.get(this._sourceFile);
	// 	if (breakpoints) {
	// 		const bps = breakpoints.filter(bp => bp.line === ln);
	// 		if (bps.length > 0) {

	// 			// send 'stopped' event
	// 			this.sendEvent('stopOnBreakpoint');

	// 			// the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
	// 			// if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
	// 			if (!bps[0].verified) {
	// 				bps[0].verified = true;
	// 				this.sendEvent('breakpointValidated', bps[0]);
	// 			}
	// 			return true;
	// 		}
	// 	}

	// 	// non-empty line
	// 	if (stepEvent && line.length > 0) {
	// 		this.sendEvent(stepEvent);
	// 		return true;
	// 	}

	// 	// nothing interesting found -> continue
	// 	return false;
	// }

	private sendEvent(event: string, ...args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}