import type { Robot } from '@hala/core'

/** Where the built AimDK (1.1.0) lives on the X2 development computer, per the organisers' notes of 24 Nov. */
export const DEFAULT_AIMDK = '/agibot/software/common'

/**
 * What to type on the robot (ssh run@10.0.1.41), in your own folder. There is no container tonight: the AimDK is
 * already built, so we point Python and ROS at it instead of sourcing a workspace. websocket-client goes into
 * ./pylib because the user "run" is shared by every team and the robot's own software (no pip --user).
 */
export function setupCommands(r: Pick<Robot, 'aimdkPath' | 'domainId'>, baseUrl: string, token: string): string {
  const url = baseUrl.replace(/\/$/, '')
  const aim = (r.aimdkPath?.trim() || DEFAULT_AIMDK).replace(/\/$/, '')
  return [
    '# your own folder (never anywhere else)',
    'mkdir -p ~/hala && cd ~/hala',
    '',
    '# environment: ROS 2 and the already-built AimDK',
    'source /opt/ros/humble/setup.bash',
    `export PYTHONPATH=${aim}/local/lib/python3.10/dist-packages:$PYTHONPATH`,
    `export LD_LIBRARY_PATH=${aim}/lib:$LD_LIBRARY_PATH`,
    `export AMENT_PREFIX_PATH=${aim}:$AMENT_PREFIX_PATH`,
    ...(r.domainId !== undefined ? [`export ROS_DOMAIN_ID=${r.domainId}`] : []),
    '',
    '# websocket-client into this folder (numpy is already on the robot)',
    'python3 -m pip install --no-deps --target ./pylib websocket-client',
    'export PYTHONPATH=$PWD/pylib:$PYTHONPATH',
    '',
    '# get the bridge and start it (raw microphone, mutes the mic while the robot speaks)',
    `curl -fsSL ${url}/hala_robot_bridge.py -o hala_robot_bridge.py`,
    `HALF_DUPLEX=1 HALA_URL=${url} HALA_ROBOT_TOKEN=${token} python3 hala_robot_bridge.py`
  ].join('\n')
}

/**
 * Before your slot: switch off the robot's own assistant (Lumi), otherwise it answers too. These are the
 * organisers' commands. Change the volume only if the room is loud.
 */
export function prepareCommands(volume = 95): string {
  return [
    '# switch the built-in assistant off for your slot',
    `ros2 service call /aimdk_5Fmsgs/srv/SetAgentPropertiesRequest aimdk_msgs/srv/SetAgentPropertiesRequest "{contents: {properties: [{key: {value: 2}, value: only_voice}]}}"`,
    '# On Robot B the next two commands answered "app agent does not exist" (the agent module is not on this computer),',
    '# and the call above had already returned code 0, so they were skipped. Only if `aima em` lists an "agent" app, run:',
    '#   aima em stop-app agent ; aima em start-app agent',
    '',
    '# loud room? (the robot was at 72)',
    `ros2 service call /aimdk_5Fmsgs/srv/SetVolume aimdk_msgs/srv/SetVolume "{audio_volume: ${volume}}"`,
    '',
    '# check nobody else is talking to the speaker',
    'ros2 topic info -v --no-daemon /aima/hal/audio/playback'
  ].join('\n')
}

/** Before you leave: stop the bridge (Ctrl+C), then put the robot back exactly as you found it. */
export function restoreCommands(volume = 72): string {
  return [
    `ros2 service call /aimdk_5Fmsgs/srv/SetVolume aimdk_msgs/srv/SetVolume "{audio_volume: ${volume}}"`,
    `ros2 service call /aimdk_5Fmsgs/srv/SetAgentPropertiesRequest aimdk_msgs/srv/SetAgentPropertiesRequest "{contents: {properties: [{key: {value: 2}, value: normal}]}}"`,
    '# only if `aima em` lists an "agent" app on your robot (it did not on Robot B):',
    '#   aima em stop-app agent ; aima em start-app agent'
  ].join('\n')
}
