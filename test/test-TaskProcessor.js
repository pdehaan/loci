/* globals Services */

"use strict";

const {TaskProcessor} = require("lib/task-queue/TaskProcessor");
const simplePrefs = require("sdk/simple-prefs");
const options = require("@loader/options");
const baseURI = simplePrefs["sdk.baseURI"] || options.prefixURI;
const {Cu} = require("chrome");
Cu.import("resource://gre/modules/Services.jsm");

function getResourceURL(path) {
  return `${baseURI}${path}`;
}

exports["test enqueue"] = function*(assert) {
  let workerURL = getResourceURL("test/resources/echo-worker.js");
  let tp = new TaskProcessor(workerURL, 1);
  let resultPromise = new Promise(resolve => {
    tp.handleResults = (data) => {
      assert.equal(0, tp.numFreeWorkers, "there are no free workers");
      assert.equal(1, data.id, "expected ID matches up");
      resolve();
    };
  });
  assert.equal(1, tp.numFreeWorkers, "there is an initial free worker");
  tp.enqueue({id: 1});
  yield resultPromise;
};

exports["test delay"] = function*(assert) {
  // delay-worker is set to wait 12 ms before responding
  let workerURL = getResourceURL("test/resources/delay-worker.js");
  // with a delay of 5 ms, and one worker, at least half of the jobs will be delayed
  let tp = new TaskProcessor(workerURL, 1, 5);
  let count = 0;
  let numTasks = 10;
  let resultPromise = new Promise(resolve => {
    tp.handleResults = (data) => {
      count += 1;
      if (count === numTasks) {
        assert.equal(count, numTasks, "handleResults called an expected number of times");
        resolve();
      }
    };
  });

  let delayPromise = new Promise(resolve => {
    let delayedCount = 0;
    let notif = "taskprocessor-worker-delayed";
    let observer = (subject, topic, data) => {
      if (topic === notif) {
        delayedCount += 1;
      }
      if (delayedCount === numTasks / 2) {
        assert.ok(true, "At least half of the enqueue requests have been delayed");
        Services.obs.removeObserver(observer, notif);
        resolve();
      }
    };
    Services.obs.addObserver(observer, notif);
  });
  for (let num of Array(numTasks).keys()) {
    tp.enqueue({id: num + 1});
  }
  yield resultPromise;
  yield delayPromise;
};

exports["test concurrency"] = function*(assert) {
  // delay-worker is set to wait 12 ms before responding
  let workerURL = getResourceURL("test/resources/delay-worker.js");
  // with 2 workers, we should have zero free workers by the time the second worker starts
  let count = 0;
  let numTasks = 10;
  let numWorkers = 5;
  let tp = new TaskProcessor(workerURL, numWorkers, 5);
  let resultPromise = new Promise(resolve => {
    tp.handleResults = (data) => {
      count += 1;
      if (count === numTasks) {
        assert.equal(count, numTasks, "handleResults called an expected number of times");
        resolve();
      }
    };
  });

  let freeNumbers = new Set();
  let countPromise = new Promise(resolve => {
    let startCount = 0;
    let notif = "taskprocessor-worker-started";
    let observer = (subject, topic, data) => {
      if (topic === notif) {
        startCount += 1;
        freeNumbers.add(tp.numFreeWorkers);
      }
      if (startCount === numTasks) {
        Services.obs.removeObserver(observer, notif);
        resolve();
      }
    };
    Services.obs.addObserver(observer, notif);
  });
  for (let num of Array(numTasks).keys()) {
    tp.enqueue({id: num + 1});
  }
  yield resultPromise;
  yield countPromise;

  // should have from `0` to `numWorkers - 1`. TP can't have `numWorkers` free workers
  // because the notification is sent when a job has already been assigned
  for (let num of Array(numWorkers).keys()) {
    assert.ok(freeNumbers.has(num), `TaskProcessor had ${num} free worker(s) at some point`);
  }
};

require("sdk/test").run(exports);
