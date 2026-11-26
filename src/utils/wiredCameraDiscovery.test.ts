import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWiredCameraList,
  classifyWiredCameraInterface,
} from './wiredCameraDiscovery';

test('classifyWiredCameraInterface accurately identifies HDMI capture, USB-C/Type-C, SDI/BNC/DVR, USB UVC, and built-in webcams', () => {
  assert.equal(classifyWiredCameraInterface('Elgato Cam Link 4K HDMI').interfaceType, 'hdmi');
  assert.equal(classifyWiredCameraInterface('USB Video (MS2109 HDMI Capture)').interfaceType, 'hdmi');
  assert.equal(classifyWiredCameraInterface('Type-C 4K Security Camera').interfaceType, 'usb-c');
  assert.equal(classifyWiredCameraInterface('USB-C UVC Camera (USB3.0)').interfaceType, 'usb-c');
  assert.equal(classifyWiredCameraInterface('AV TO USB2.0 BNC DVR Capture').interfaceType, 'sdi-bnc');
  assert.equal(classifyWiredCameraInterface('Logitech C920 HD Pro Webcam').interfaceType, 'usb');
  assert.equal(classifyWiredCameraInterface('Integrated Webcam (HP Wide Vision)').interfaceType, 'built-in');
  assert.equal(classifyWiredCameraInterface('').interfaceType, 'wired-generic');
});

test('buildWiredCameraList pairs HDMI/USB-C audio via groupId and prioritizes external wired cameras over built-in laptop cam', () => {
  const list = buildWiredCameraList(
    [
      { deviceId: 'cam-builtin', groupId: 'grp-laptop', label: 'Integrated HD Webcam' },
      { deviceId: 'cam-usbc', groupId: 'grp-usbc', label: 'Anker USB-C 4K Cam' },
      { deviceId: 'cam-hdmi', groupId: 'grp-hdmi', label: 'USB Video Capture Card (HDMI)' },
    ],
    [
      { deviceId: 'mic-hdmi', groupId: 'grp-hdmi', label: 'Digital Audio Interface (HDMI Capture)' },
      { deviceId: 'mic-usbc', groupId: 'grp-usbc', label: 'Anker USB-C Microphone' },
    ]
  );

  assert.equal(list.length, 3);
  assert.equal(list[0].interfaceType, 'hdmi');
  assert.equal(list[0].matchedAudioDeviceId, 'mic-hdmi');
  assert.equal(list[1].interfaceType, 'usb-c');
  assert.equal(list[1].matchedAudioDeviceId, 'mic-usbc');
  assert.equal(list[2].interfaceType, 'built-in');
  assert.equal(list[2].matchedAudioDeviceId, undefined);
});
