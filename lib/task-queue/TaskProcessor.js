/* globals Services */
"use strict";
const {LIFOQueue} = require("lib/task-queue/Queue");
const {Cu, ChromeWorker} = require("chrome");
const {setTimeout, clearTimeout} = require("sdk/timers");

Cu.import("resource://gre/modules/Services.jsm");

class TaskProcessor {
  /**
   * A generic Task Processor whose purpose is to managed workers
   *
   * @param {String}    workerScriptURL
   *                    URL of script to start workers with. This needs to be a resouce URL (required)
   * @param {Integer}   numWorkers
   *                    Number of workers to spawn (default: 5)
   * @param {Integer}   timeoutDelay
   *                    Amount of time in milliseconds to wait until retrying when jobs are queued up (default: 50)
   */
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

  /**
   * A callback invoked when workers emit messages
   *
   * @param {Event}     evt
   *                    An Event object
   */
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

  /**
   * Returns the size of the worker pool
   */
  get numWorkers() {
    return this._workers.size;
  }

  /**
   * Returns the number of free workers
   */
  get numFreeWorkers() {
    return this._freeWorkers.size;
  }

  /**
   * Add an object to the queue to be processed by a background worker
   *
   * @param {Object} task
   *                 An object whose value will be given to a worker
   */
  enqueue(task) {
    this._queue.enqueue(task);
    this._distributeTask();
  }

  /**
   * A results handler that needs to be implemented.
   */
  handleResults(data) {
    throw new Error("Function not implemented");
  }

  /**
   * Initializes workers with a given script
   */
  _createWorkers() {
    for (let _ of Array(this._numWorkers).keys()) { // eslint-disable-line no-unused-vars
      let worker = new ChromeWorker(this._workerScriptURL);
      worker.addEventListener("message", this, false);
      worker.addEventListener("error", this, false);
      this._workers.add(worker);
      this._freeWorkers.add(worker);
    }
  }

  /**
   * Ensures jobs on a queue will be distributed to workers. This will run periodically until
   * all jobs are completed.
   */
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

  /**
   * Uninitializes the processor
   */
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
