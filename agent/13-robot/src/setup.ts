import type { Robot } from '@hala/core'

// ---------------------------------------------------------------- setup command

/**
 * What to type on the robot's development computer (PC2, inside the MangoBot container). It sources ROS and the
 * AimDK workspace, then starts the bridge. Built from the details entered on the Robots page.
 */
export function setupCommands(r: Pick<Robot, 'aimdkPath' | 'domainId'>, baseUrl: string, token: string): string {
  const url = baseUrl.replace(/\/$/, '')
  return [
    '# once: Python packages for the bridge',
    'pip3 install websocket-client numpy',
    '',
    '# every time: load ROS 2 and the AimDK workspace, then start the bridge',
    'source /opt/ros/humble/setup.bash',
    `source ${r.aimdkPath?.trim() || '<path to aimdk>'}/install/setup.bash`,
    ...(r.domainId !== undefined ? [`export ROS_DOMAIN_ID=${r.domainId}`] : []),
    `curl -fsSL ${url}/hala_robot_bridge.py -o hala_robot_bridge.py`,
    `HALA_URL=${url} HALA_ROBOT_TOKEN=${token} python3 hala_robot_bridge.py`
  ].join('\n')
}
