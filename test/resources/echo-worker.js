/* globals importScripts, start, emit */
/* exported start */

"use strict";

importScripts("../../data/workers/base.js");

start = (data) => {
  emit(data);
};
