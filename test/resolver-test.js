/*
 * Copyright (c) 2008-present Sonatype, Inc.
 *
 * All rights reserved. Includes the third-party code listed at http://links.sonatype.com/products/nexus/oss/attributions.
 *
 * This program and the accompanying materials are made available under the terms of the Eclipse Public License Version 1.0,
 * which accompanies this distribution and is available at http://www.eclipse.org/legal/epl-v10.html.
 *
 * Sonatype Nexus (TM) Professional Version is available from Sonatype, Inc. "Sonatype" and "Sonatype Nexus" are trademarks
 * of Sonatype, Inc. Apache Maven is a trademark of the Apache Software Foundation. M2eclipse is a trademark of the
 * Eclipse Foundation. All other trademarks are the property of their respective owners.
 */

var assert = require('assert');
var fs = require('fs');
var nock = require('nock');
var Q = require('q');
var resolverFactory = require('../src/index');
var sinon = require('sinon');
var tmp = require('tmp');

tmp.setGracefulCleanup();

describe('bower-nexus3-resolver', function() {

  var resolver = null;
  beforeEach(function() {
    resolver = resolverFactory({
      config: {}
    });
  });

  describe('match()', function() {
    it('should match a URL that references Nexus over http', function() {
      assert.equal(resolver.match('nexus+http://host/repo'), true);
    });
    it('should match a URL that references Nexus over https', function() {
      assert.equal(resolver.match('nexus+https://host/repo'), true);
    });
    it('should not match a URL that references git', function() {
      assert.equal(resolver.match('git://host/repo.git'), false);
    });
    it('should not match a URL that references http', function() {
      assert.equal(resolver.match('http://host/repo'), false);
    });
    it('should not match a URL that references Artifactory', function() {
      assert.equal(resolver.match('art://host/repo'), false);
    });
  });

  describe('locate()', function() {
    it('should not alter a provided Nexus HTTP URL', function() {
      assert.equal(resolver.locate('nexus+http://host/repo'), 'nexus+http://host/repo');
    });
    it('should not alter a provided Nexus HTTPS URL', function() {
      assert.equal(resolver.locate('nexus+https://host/repo'), 'nexus+https://host/repo');
    });
  });

  describe('releases()', function() {
    it('should return targets and versions for provided versions', function() {
      var _downloadString = sinon.stub(resolver, '_downloadString');
      var _parseVersions = sinon.stub(resolver, '_parseVersions');
      _downloadString.withArgs('http://hostname:8080/repository/reponame/packagename/versions.json').returns(
          Q('releases'));
      _parseVersions.withArgs('releases').returns([
        {
          target: 'target',
          version: 'version'
        }
      ]);
      return resolver.releases('nexus+http://hostname:8080/repository/reponame/packagename').then(function(releases) {
        _downloadString.restore();
        _parseVersions.restore();
        assert.deepEqual(releases, [
          {
            target: 'target',
            version: 'version'
          }
        ]);
      });
    });
  });

  describe('fetch()', function() {
    it('should attempt to download and extract a file for a particular Nexus archive URL', function() {
      var _downloadFile = sinon.stub(resolver, '_downloadFile');
      var _extractTarGz = sinon.stub(resolver, '_extractTarGz');
      _downloadFile.withArgs('http://hostname:8080/repository/reponame/packagename/1.2.3/package.tar.gz',
          sinon.match.string)
          .returns(Q('filename'));
      _extractTarGz.withArgs('filename').returns(Q('path'));
      return resolver.fetch({
        source: 'nexus+http://hostname:8080/repository/reponame/packagename',
        target: '1.2.3'
      }, null).then(function(path) {
        assert.deepEqual(path, {
          tempPath: 'path',
          removeIgnores: true
        });
        _downloadFile.restore();
        _extractTarGz.restore();
      });
    });
    it('should return undefined if an item already exists in the cache with the same version', function() {
      var result = resolver.fetch({
        source: 'nexus+http://hostname:8080/repository/reponame/packagename',
        target: '1.2.3'
      }, {
        version: '1.2.3'
      });
      assert.strictEqual(result, undefined);
    });
  });

  describe('_parseNexusUrl()', function() {
    it('should parse a nexus+http:// url into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+http://hostname:8080/repository/reponame/packagename');
      var expected = {
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
    it('should parse a nexus+https:// url into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+https://hostname:8080/repository/reponame/packagename');
      var expected = {
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
    it('should parse a nexus+http:// url containing a simple context path into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+http://hostname:8080/context/repository/reponame/packagename');
      var expected = {
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
    it('should parse a nexus+https:// url containing a simple context path into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+https://hostname:8080/context/repository/reponame/packagename');
      var expected = {
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
    it('should parse a nexus+http:// url containing a complex context path into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+http://hostname:8080/context/path/repository/reponame/packagename');
      var expected = {
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
    it('should parse a nexus+https:// url containing a complex context path into the important components', function() {
      var actual = resolver._parseNexusUrl('nexus+https://hostname:8080/context/path/repository/reponame/packagename');
      var expected = {
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      };
      assert.deepEqual(actual, expected);
    });
  });

  describe('_buildNexusVersionsEndpoint()', function() {
    it('should build an http:// url for a specific versions endpoint in Nexus', function() {
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'http://hostname:8080/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
    it('should build an http:// url with context path for a specific versions endpoint in Nexus', function() {
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'http://hostname:8080/context/path/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
    it('should build an https:// url for a specific versions endpoint in Nexus', function() {
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'https://hostname:8080/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
    it('should build an https:// url with context path for a specific versions endpoint in Nexus', function() {
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'https://hostname:8080/context/path/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
    it('should build a url with auth information for nexus', function() {
      var resolver = resolverFactory({
        config: {
          nexus: {
            username: 'user',
            password: 'pass'
          }
        }
      });
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'http://user:pass@hostname:8080/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
    it('should build a url with context path with auth information for nexus', function() {
      var resolver = resolverFactory({
        config: {
          nexus: {
            username: 'user',
            password: 'pass'
          }
        }
      });
      var actual = resolver._buildNexusVersionsEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      });
      var expected = 'http://user:pass@hostname:8080/context/path/repository/reponame/packagename/versions.json';
      assert.deepEqual(actual, expected);
    });
  });

  describe('_buildNexusArchiveEndpoint()', function() {
    it('should build an http:// url for a specific tar.gz archive in Nexus', function() {
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'http://hostname:8080/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
    it('should build an http:// url with context path for a specific tar.gz archive in Nexus', function() {
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'http://hostname:8080/context/path/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
    it('should build an https:// url for a specific tar.gz archive in Nexus', function() {
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'https://hostname:8080/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
    it('should build an https:// url with context path for a specific tar.gz archive in Nexus', function() {
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'https:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'https://hostname:8080/context/path/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
    it('should build a url with auth information in Nexus', function() {
      var resolver = resolverFactory({
        config: {
          nexus: {
            username: 'user',
            password: 'pass'
          }
        }
      });
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'http://user:pass@hostname:8080/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
    it('should build a url with context path with auth information in Nexus', function() {
      var resolver = resolverFactory({
        config: {
          nexus: {
            username: 'user',
            password: 'pass'
          }
        }
      });
      var actual = resolver._buildNexusArchiveEndpoint({
        protocol: 'http:',
        hostname: 'hostname',
        port: '8080',
        path: '/context/path/repository',
        repositoryName: 'reponame',
        packageName: 'packagename'
      }, '1.2.3');
      var expected = 'http://user:pass@hostname:8080/context/path/repository/reponame/packagename/1.2.3/package.tar.gz';
      assert.deepEqual(actual, expected);
    });
  });

  describe('_buildAuth()', function() {
    it('should build an auth string when both username and password are present', function() {
      var resolver = resolverFactory({
        config: {
          nexus: {
            username: 'user',
            password: 'pass'
          }
        }
      });
      var actual = resolver._buildAuth();
      var expected = 'user:pass';
      assert.deepEqual(actual, expected);
    });
    it('should not build an auth string when both username and password are absent', function() {
      var actual = resolver._buildAuth();
      var expected = null;
      assert.deepEqual(actual, expected);
    });
  });

  describe('_parseVersions()', function() {
    it('should parse a string containing Nexus-provided release data into a Bower resolver releases object',
        function() {
          var actual = resolver._parseVersions('["1.7.1rc1", "2.0.1", "3.0.0-alpha1"]');
          var expected = [
            {
              target: '1.7.1rc1',
              version: '1.7.1rc1'
            },
            {
              target: '2.0.1',
              version: '2.0.1'
            },
            {
              target: '3.0.0-alpha1',
              version: '3.0.0-alpha1'
            }
          ];
          assert.deepEqual(actual, expected);
        });
  });

  describe('_getTempPath()', function() {
    it('should return the temporary directory itself when the old files and new files are the same', function() {
      var tempDir = tmp.dirSync();
      var beforeFiles = fs.readdirSync(tempDir.name);
      var afterFiles = fs.readdirSync(tempDir.name);
      var actual = resolver._getTempPath(tempDir.name, beforeFiles, afterFiles);
      var expected = tempDir.name;
      assert.equal(actual, expected);
    });
    it('should return the temporary directory when there is a new file', function() {
      var tempDir = tmp.dirSync();
      var beforeFiles = fs.readdirSync(tempDir.name);
      tmp.fileSync({dir: tempDir.name});
      var afterFiles = fs.readdirSync(tempDir.name);
      var actual = resolver._getTempPath(tempDir.name, beforeFiles, afterFiles);
      var expected = tempDir.name;
      assert.equal(actual, expected);
    });
    it('should return the temporary subdirectory when there is a new subdirectory only', function() {
      var tempDir = tmp.dirSync();
      var beforeFiles = fs.readdirSync(tempDir.name);
      var tempChildDir = tmp.dirSync({dir: tempDir.name});
      var afterFiles = fs.readdirSync(tempDir.name);
      var actual = resolver._getTempPath(tempDir.name, beforeFiles, afterFiles);
      var expected = tempChildDir.name;
      assert.equal(actual, expected);
    });
    it('should return the temporary directory when there is a new subdirectory and a new file', function() {
      var tempDir = tmp.dirSync();
      var beforeFiles = fs.readdirSync(tempDir.name);
      tmp.fileSync({dir: tempDir.name});
      tmp.dirSync({dir: tempDir.name});
      var afterFiles = fs.readdirSync(tempDir.name);
      var actual = resolver._getTempPath(tempDir.name, beforeFiles, afterFiles);
      var expected = tempDir.name;
      assert.equal(actual, expected);
    });
  });

  describe('_downloadString()', function() {
    it('should download a string and return it via a promise', function() {
      nock('http://example.com').get('/endpoint').reply(200, 'content');
      return resolver._downloadString('http://example.com/endpoint').then(function(result) {
        assert.equal(result, 'content');
      });
    });
    it('should appropriately handle a non-200 status code via a promise', function() {
      nock('http://example.com').get('/endpoint').reply(404);
      return resolver._downloadString('http://example.com/endpoint')
          .then(function(result) {
            assert.fail('Should fail but yielded ' + result);
          })
          .catch(function(error) {
            assert.equal(error.message, 'http://example.com/endpoint (HTTP 404)');
          });
    });
    it('should appropriately handle an http error condition via a promise', function() {
      return resolver._downloadString('http://foo')
          .then(function(result) {
            assert.fail('Should fail but yielded ' + result);
          })
          .catch(function(error) {
            assert(error.message.indexOf('ENOTFOUND') >= 0);
          });
    });
  });

  describe('_downloadFile()', function() {
    it('should download a file and return it via a promise', function() {
      nock('http://example.com').get('/endpoint').reply(200, 'abcdefg');
      var tempfile = tmp.fileSync();
      return resolver._downloadFile('http://example.com/endpoint', tempfile.name)
          .then(function(result) {
            assert.equal(result, tempfile.name);
            fs.readFile(tempfile.name, 'utf8', function(err, data) {
              if (err) {
                assert.fail('Unable to read file: ' + err);
              }
              assert.equal(data, 'abcdefg');
            });
          });
    });
    it('should appropriately handle a non-200 status code via a promise', function() {
      nock('http://example.com').get('/endpoint').reply(404);
      var tempfile = tmp.fileSync();
      return resolver._downloadFile('http://example.com/endpoint', tempfile.name)
          .then(function(result) {
            assert.fail('Should fail but yielded ' + result);
          })
          .catch(function(error) {
            assert.equal(error.message, 'http://example.com/endpoint (HTTP 404)');
          });
    });
    it('should appropriately handle an http error condition via a promise', function() {
      var tempfile = tmp.fileSync();
      return resolver._downloadFile('http://foo', tempfile.name)
          .then(function(result) {
            assert.fail('Should fail but yielded ' + result);
          })
          .catch(function(error) {
            assert(error.message.indexOf('ENOTFOUND') >= 0);
          });
    });
  });
});
