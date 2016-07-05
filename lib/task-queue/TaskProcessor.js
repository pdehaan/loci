/* globals Services */
"use strict";
const {LIFOQueue} = require("lib/task-queue/Queue");
const {Cu, ChromeWorker} = require("chrome");
const {setTimeout, clearTimeout} = require("sdk/timers");

Cu.import("resource://gre/modules/Services.jsm");

class TaskProcessor {
  constructor(workerScriptURL, numWorkers = 5, timeoutDelay = 50) {
    this._numWorkers = numWorkers;
    this._workerScriptURL = workerScriptURL;
    this._queue = new LIFOQueue();
    this._workers = new Set();
    this._freeWorkers = new Set();
    this._createWorkers();
    this._distributeTaskTimeout = null;
    this._timeoutDelay = timeoutDelay;
  }

  handleEvent(evt) {
    switch (evt.type) {
      case "message":
        if (evt.data && evt.data.name === "result") {
          this.handleResults(evt.data.payload);
        }
        break;
      case "error":
        Cu.reportError(evt.message);
        break;
    }
    this._freeWorkers.add(evt.target);
  }

  get numWorkers() {
    return this._workers.size;
  }

  get numFreeWorkers() {
    return this._freeWorkers.size;
  }

  enqueue(task) {
    this._queue.enqueue(task);
    this._distributeTask();
  }

  handleResults(data) {
    throw new Error("Function not implemented");
  }

  _createWorkers() {
    for (let _ of Array(this._numWorkers).keys()) { // eslint-disable-line no-unused-vars
      let worker = new ChromeWorker(this._workerScriptURL);
      worker.addEventListener("message", this, false);
      worker.addEventListener("error", this, false);
      this._workers.add(worker);
      this._freeWorkers.add(worker);
    }
  }

  _distributeTask() {
    if (this._distributeTaskTimeout === null) {
      if (this._queue.size > 0 && this._freeWorkers.size > 0) {
        let worker = this._freeWorkers.values().next().value;
        let payload = this._queue.dequeue();
        this._freeWorkers.delete(worker);

        worker.postMessage({
          command: "start",
          payload,
        });
        Services.obs.notifyObservers(null, "taskprocessor-worker-started", this._workerScriptURL);
      }

      if (this._queue.size > 0) {
        this._distributeTaskTimeout = setTimeout(() => {
          this._distributeTaskTimeout = null;
          this._distributeTask();
        }, this._timeoutDelay);
        Services.obs.notifyObservers(null, "taskprocessor-worker-delayed", null);
      }
    }
  }

  uninit() {
    if (this._distributeTaskTimeout) {
      clearTimeout(this._distributeTaskTimeout);
      this._distributeTaskTimeout = null;
    }
    for (let workerSet of [this._freeWorkers, this._workers]) {
      for (let worker of workerSet) {
        worker.terminate();
        workerSet.delete(worker);
      }
    }
  }
}

exports.TaskProcessor = TaskProcessor;
