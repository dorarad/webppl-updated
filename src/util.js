'use strict';

var _ = require('lodash');
var assert = require('assert');
var seedrandom = require('seedrandom');
var ad = require('./ad');
var Tensor = require('./tensor');

var rng = Math.random;

var trampolineRunners = {
  web: function(yieldEvery) {
    yieldEvery = yieldEvery || 100;
    var f = function(t, wrappedF) {
      var lastPauseTime = Date.now();

      if (f.__cancel__) {
        f.__cancel__ = false;
      } else {
        while (t) {
          var currTime = Date.now();
          if (currTime - lastPauseTime > yieldEvery) {
            // NB: return is crucial here as it exits the while loop
            // and i'm using return rather than break because we might
            // one day want to cancel the timer
            return setTimeout(function() { wrappedF(t, wrappedF); }, 0);
          } else {
            t = t();
          }
        }
      }
    };
    return f;
  },
  cli: function() {
    return function(t) {
      while (t) {
        t = t()
      }
    };
  }
}



function random() {
  return rng();
}

function seedRNG(seed) {
  rng = seedrandom(seed);
}

function resetRNG() {
  rng = Math.random;
}

function assertValidRandomSeed(seed) {
  var msg = 'Random seed should be a positive integer.';
  assert(_.isFinite(seed) && seed >= 0, msg);
}

function runningInBrowser() {
  return (typeof window !== 'undefined');
}

function makeGensym() {
  var seq = 0;
  return function(prefix) {
    var result = prefix + seq;
    seq += 1;
    return result;
  };
}

var gensym = makeGensym();

function prettyJSON(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function asArray(arg) {
  return arg ? [].concat(arg) : [];
}

function sum(xs) {
  if (xs.length === 0) {
    return 0.0;
  } else {
    var total = _.reduce(xs,
        function(a, b) {
          return a + b;
        });
    return total;
  }
}

function product(xs) {
  var result = 1;
  for (var i = 0, n = xs.length; i < n; i++) {
    result *= xs[i];
  }
  return result;
}

function logsumexp(a) {
  var m = Math.max.apply(null, a);
  var sum = 0;
  for (var i = 0; i < a.length; ++i) {
    sum += (a[i] === -Infinity ? 0 : Math.exp(a[i] - m));
  }
  return m + Math.log(sum);
}

var deleteIndex = function(arr, i) {
  return arr.slice(0, i).concat(arr.slice(i + 1))
}

// func(x, i, xs, cont)
// cont()
function cpsForEach(func, cont, xs, i) {
  i = (i === undefined) ? 0 : i;
  if (i === xs.length) {
    return cont();
  } else {
    return func(xs[i], i, xs, function() {
      return function() { // insert trampoline step
        return cpsForEach(func, cont, xs, i + 1);
      };
    });
  }
}

function cpsLoop(n, func, cont) {
  function loop(i) {
    if (i === n) {
      return cont();
    } else {
      return func(i, function() {
        return function() { // insert trampoline step
          return loop(i + 1);
        };
      });
    }
  }
  assert(_.isNumber(n), 'Number expected.');
  return loop(0);
}

function cpsIterate(n, initial, func, cont) {
  var val = initial;
  return cpsLoop(n,
      function(i, next) {
        return func(function(nextVal) {
          val = nextVal;
          return next();
        }, val);
      },
      function() { return cont(val); });
}

function histExpectation(hist, func) {
  var f = func || _.identity;
  return _.reduce(hist, function(acc, obj) {
    return acc + obj.prob * f(obj.val);
  }, 0);
}

function histStd(hist) {
  var m = histExpectation(hist);
  return Math.sqrt(histExpectation(hist, function(x) {
    return Math.pow(x - m, 2);
  }));
}

function sameKeys(obj1, obj2) {
  return _.size(obj1) === _.size(obj2) &&
      _.every(_.keys(obj1), function(key) { return _.has(obj2, key); });
}

function histsApproximatelyEqual(actualHist, expectedHist, tolerance, exactSupport) {
  if (expectedHist === undefined || actualHist === undefined) {
    return false;
  }
  if (exactSupport && !sameKeys(actualHist, expectedHist)) {
    return false;
  }
  return _.every(expectedHist, function(expectedValue, key) {
    var value = actualHist[key] || 0;
    return Math.abs(value - expectedValue) <= tolerance;
  });
}

function mergeDefaults(options, defaults) {
  return _.defaults(options ? _.clone(options) : {}, defaults);
}

function throwUnlessOpts(options, fnName) {
  assert.ok(fnName);
  if (options !== undefined && !_.isObject(options)) {
    throw fnName + ' expected an options object but received: ' + JSON.stringify(options);
  }
}

// When using an object to fake named function parameters we sometimes
// accept a string *or* and object as a way of passing both a string
// *and* a related set of sub options. This helper takes such a value,
// extracts the string and object, passes them through a continuation
// and returns the result.

// getValAndOpts('foo', (name, opts) => [name, opts])
// => ['foo', {}]
// getValAndOpts({foo: {bar: 0}}, (name, opts) => [name, opts])
// => ['foo', {bar: 0}]

function getValAndOpts(obj, cont) {
  var args;
  if (_.isString(obj)) {
    args = [obj, {}];
  } else {
    if (_.size(obj) !== 1) {
      throw 'Expected an object with a single key but received: ' + JSON.stringify(obj);
    }
    var key = _.keys(obj)[0];
    args = [key, obj[key]];
  }
  return cont.apply(null, args);
}

function InfToJSON(k, v) {
  if (v === Infinity) {
    return 'Infinity';
  } else if (v === -Infinity) {
    return '-Infinity';
  } else {
    return v;
  }
}

function InfFromJSON(k, v) {
  if (v === 'Infinity') {
    return Infinity;
  } else if (v === '-Infinity') {
    return -Infinity;
  } else {
    return v;
  }
}

function serialize(o) {
  return JSON.stringify(o, InfToJSON);
}

function deserialize(o) {
  return JSON.parse(o, InfFromJSON);
}

function time(name, thunk) {
  if (console.time) {
    console.time(name);
    var ret = thunk();
    console.timeEnd(name);
    return ret;
  } else {
    return thunk();
  }
}

function timeif(bool, name, thunk) {
  return bool ? time(name, thunk) : thunk();
}

var warningsIssued = {};

function resetWarnings() {
  warningsIssued = {};
}

function warn(msg, onceOnly) {
  if (!global.suppressWarnings &&
      (!onceOnly || !_.has(warningsIssued, msg))) {
    console.warn(msg);
    if (onceOnly) {
      warningsIssued[msg] = true;
    }
  }
}

function fatal(msg) {
  throw msg;
}

function jsnew(ctor, arg) {
  return new ctor(arg);
}

// Equivalent to Number.isInteger(), which isn't available in the
// version of phantom.js used on Travis at the time of writing.
function isInteger(x) {
  return typeof x === 'number' &&
      isFinite(x) &&
      Math.floor(x) === x;
}

// Unlike _.isObject this returns false for arrays and functions.
function isObject(x) {
  return x !== undefined &&
         x !== null &&
         typeof x === 'object' && // required for Node <= 0.12
         Object.getPrototypeOf(x) === Object.prototype;
}

function isTensor(t) {
  return t instanceof Tensor;
}

function isMatrix(t) {
  return t instanceof Tensor && t.rank === 2;
}

function isVector(t) {
  return t instanceof Tensor && t.rank === 2 && t.dims[1] === 1;
}

function tensorEqDim0(v, w) {
  // Useful for checking two vectors have the same length, or that the
  // dimension of a vector and matrix match.
  return v.dims[0] === w.dims[0];
}

function tensorEqDims(t1, t2) {
  if (t1.dims.length !== t2.dims.length) {
    return false;
  }
  for (var i = 0; i < t1.dims.length; i++) {
    if (t1.dims[i] !== t2.dims[i]) {
      return false;
    }
  }
  return true;
}

function relativizeAddress(env, address) {
  // Takes the env and a full stack address and returns a new address
  // relative to the entry address of the current coroutine. This
  // requires each coroutine to save its entry address as `this.a`.
  assert.ok(_.has(env.coroutine, 'a'), 'Entry address not saved on coroutine.');
  var baseAddress = env.coroutine.a;
  assert.ok(address.slice(0, baseAddress.length) === baseAddress, 'Address prefix mismatch.');
  return address.slice(baseAddress.length);
}

module.exports = {
  trampolineRunners: trampolineRunners,
  random: random,
  seedRNG: seedRNG,
  resetRNG: resetRNG,
  assertValidRandomSeed: assertValidRandomSeed,
  cpsForEach: cpsForEach,
  cpsLoop: cpsLoop,
  cpsIterate: cpsIterate,
  histExpectation: histExpectation,
  histStd: histStd,
  histsApproximatelyEqual: histsApproximatelyEqual,
  gensym: gensym,
  logsumexp: logsumexp,
  deleteIndex: deleteIndex,
  makeGensym: makeGensym,
  prettyJSON: prettyJSON,
  runningInBrowser: runningInBrowser,
  mergeDefaults: mergeDefaults,
  throwUnlessOpts: throwUnlessOpts,
  getValAndOpts: getValAndOpts,
  sum: sum,
  product: product,
  asArray: asArray,
  serialize: serialize,
  deserialize: deserialize,
  timeif: timeif,
  warn: warn,
  resetWarnings: resetWarnings,
  fatal: fatal,
  jsnew: jsnew,
  isInteger: isInteger,
  isObject: isObject,
  isTensor: isTensor,
  isVector: isVector,
  isMatrix: isMatrix,
  tensorEqDim0: tensorEqDim0,
  tensorEqDims: tensorEqDims,
  relativizeAddress: relativizeAddress
};
